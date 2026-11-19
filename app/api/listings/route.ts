import { cookies } from "next/headers";
import Stripe from "stripe";
import { createConnectedAccountLink } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { getOrCreateSellerAccount } from "@/lib/connect";
import { sendSellerOnboardingLink } from "@/lib/marketplace-email";
import { isSameOriginRequest, isValidEmail } from "@/lib/http";
import {
  hashSellerVerificationToken,
  normalizeEmail,
  sellerVerificationCookie,
} from "@/lib/seller-verification";

type CreateListingRequest = {
  id?: unknown;
  title?: unknown;
  price?: unknown;
  category?: unknown;
  location?: unknown;
  sellerName?: unknown;
  sellerEmail?: unknown;
  sellerCountry?: unknown;
  description?: unknown;
  imagePath?: unknown;
};

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function stripeSetupError(error: unknown) {
  return (
    error instanceof Stripe.errors.StripeError &&
    error.code === "account_create_activation_required"
  );
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return Response.json({ error: "Invalid request origin." }, { status: 403 });
  }

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 20_000) {
    return Response.json({ error: "The listing is too large." }, { status: 413 });
  }

  let payload: CreateListingRequest;
  try {
    payload = (await request.json()) as CreateListingRequest;
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  const id = typeof payload.id === "string" ? payload.id : "";
  const title = typeof payload.title === "string" ? payload.title.trim() : "";
  const price = Number(payload.price);
  const category =
    typeof payload.category === "string" ? payload.category.trim() : "";
  const location =
    typeof payload.location === "string" ? payload.location.trim() : "";
  const sellerName =
    typeof payload.sellerName === "string" ? payload.sellerName.trim() : "";
  const sellerEmail =
    typeof payload.sellerEmail === "string" ? payload.sellerEmail.trim() : "";
  const sellerCountry =
    typeof payload.sellerCountry === "string"
      ? payload.sellerCountry.trim().toUpperCase()
      : "";
  const description =
    typeof payload.description === "string"
      ? payload.description.trim()
      : "";
  const imagePath =
    typeof payload.imagePath === "string" ? payload.imagePath : "";

  if (
    !isUuid(id) ||
    title.length < 2 ||
    title.length > 120 ||
    !Number.isFinite(price) ||
    price <= 0 ||
    price > 1_000_000 ||
    category.length < 1 ||
    category.length > 80 ||
    location.length < 1 ||
    location.length > 160 ||
    sellerName.length < 1 ||
    sellerName.length > 120 ||
    !isValidEmail(sellerEmail) ||
    !/^[A-Z]{2}$/.test(sellerCountry) ||
    description.length < 5 ||
    description.length > 2000 ||
    !new RegExp(
      `^${id}\\.(jpg|png|webp|gif|avif)$`,
      "i",
    ).test(imagePath)
  ) {
    return Response.json({ error: "Check the listing details and try again." }, { status: 400 });
  }

  const email = normalizeEmail(sellerEmail);
  try {
    const cookieStore = await cookies();
    const verificationToken = cookieStore.get(sellerVerificationCookie)?.value;
    if (!verificationToken) {
      return Response.json(
        { error: "Verify the seller email before creating a listing." },
        { status: 403 },
      );
    }

    const supabase = createAdminClient();
    const tokenHash = hashSellerVerificationToken(verificationToken);
    const { data: verification, error: verificationError } = await supabase
      .from("seller_email_verifications")
      .select("email")
      .eq("verification_token_hash", tokenHash)
      .gt("verified_until", new Date().toISOString())
      .maybeSingle();

    if (verificationError) {
      console.error("Could not check verified seller email:", verificationError);
      return Response.json(
        { error: "Could not verify the seller email. Please try again." },
        { status: 500 },
      );
    }
    if (!verification || verification.email !== email) {
      return Response.json(
        { error: "Verify this seller email before creating a listing." },
        { status: 403 },
      );
    }

    const sellerAccount = await getOrCreateSellerAccount(
      email,
      sellerName,
      sellerCountry,
      id,
    );
    let onboardingUrl: string | null = null;

    if (!sellerAccount.readiness.complete) {
      const { error: tokenError } = await supabase
        .from("seller_accounts")
        .update({
          onboarding_refresh_token_hash: hashSellerVerificationToken(
            sellerAccount.refreshToken!,
          ),
        })
        .eq("email", email);

      if (tokenError) {
        console.error("Could not save seller onboarding refresh token:", tokenError);
        return Response.json(
          { error: "Could not start Stripe onboarding. Please try again." },
          { status: 500 },
        );
      }

      const accountLink = await createConnectedAccountLink(
        sellerAccount.accountId,
        sellerAccount.refreshToken!,
        id,
      );
      onboardingUrl = accountLink.url;
    }

    const status = sellerAccount.readiness.complete
      ? "available"
      : "pending_onboarding";
    const { error: insertError } = await supabase.from("listings").insert({
      id,
      title,
      price,
      category,
      location,
      seller_name: sellerName,
      seller_email: email,
      seller_country: sellerCountry,
      seller_address: null,
      seller_phone: null,
      description,
      image_path: imagePath,
      status,
      reserved_order_id: null,
      sold_at: null,
    });

    if (insertError) {
      console.error("Could not save marketplace listing:", insertError);
      return Response.json(
        { error: "Could not save the listing. Please try again." },
        { status: 500 },
      );
    }

    let onboardingEmailSent = false;
    if (onboardingUrl) {
      try {
        await sendSellerOnboardingLink(email, sellerName, title, onboardingUrl);
        onboardingEmailSent = true;
      } catch (emailError) {
        console.error("Could not email seller onboarding link:", emailError);
      }
    }

    return Response.json(
      {
        created: true,
        sellerOnboardingComplete: sellerAccount.readiness.complete,
        onboardingUrl,
        onboardingEmailSent,
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof Error && error.message.includes("different country")) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    if (
      error instanceof Stripe.errors.StripeError &&
      error.code === "resource_missing" &&
      error.param === "account"
    ) {
      return Response.json(
        {
          error:
            "The seller's saved Stripe account was not found in the current Stripe environment. Check that STRIPE_SECRET_KEY points to the same Stripe platform and test or live mode where this account was created. If you intentionally changed environments, the seller needs to restart onboarding there.",
        },
        { status: 409 },
      );
    }
    if (stripeSetupError(error)) {
      return Response.json(
        {
          error:
            "Stripe Connect is not active for this platform account yet. Confirm account eligibility and activate Connect in Stripe before creating seller accounts.",
        },
        { status: 503 },
      );
    }
    console.error("Could not create marketplace listing:", error);
    return Response.json(
      { error: "Could not create the listing or verify Stripe onboarding." },
      { status: 503 },
    );
  }
}
