import { createConnectedAccountLink } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { hashSellerVerificationToken, safeHashEquals } from "@/lib/seller-verification";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const accountId = url.searchParams.get("account") ?? "";
  const token = url.searchParams.get("token") ?? "";
  const listingId = url.searchParams.get("listing_id");
  if (!/^acct_[A-Za-z0-9]+$/.test(accountId) || token.length < 40) {
    return new Response("Invalid onboarding refresh link.", { status: 400 });
  }
  if (
    listingId &&
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      listingId,
    )
  ) {
    return new Response("Invalid onboarding refresh link.", { status: 400 });
  }

  try {
    const supabase = createAdminClient();
    const { data: seller, error } = await supabase
      .from("seller_accounts")
      .select("email, onboarding_refresh_token_hash, onboarding_complete")
      .eq("stripe_account_id", accountId)
      .maybeSingle();

    if (error) {
      console.error("Could not look up seller for onboarding refresh:", error);
      return new Response("Could not refresh onboarding. Please try again.", {
        status: 500,
      });
    }
    if (
      !seller ||
      seller.onboarding_complete ||
      !seller.onboarding_refresh_token_hash ||
      !safeHashEquals(
        seller.onboarding_refresh_token_hash,
        hashSellerVerificationToken(token),
      )
    ) {
      return new Response("This onboarding link is invalid or no longer needed.", {
        status: 403,
      });
    }

    if (listingId) {
      const { data: listing, error: listingError } = await supabase
        .from("listings")
        .select("id")
        .eq("id", listingId)
        .eq("seller_email", seller.email)
        .eq("status", "pending_onboarding")
        .maybeSingle();
      if (listingError || !listing) {
        console.error("Could not verify listing for onboarding refresh:", listingError);
        return new Response("This listing is no longer awaiting onboarding.", {
          status: 404,
        });
      }
    }

    const link = await createConnectedAccountLink(
      accountId,
      token,
      listingId ?? undefined,
    );
    return Response.redirect(link.url, 303);
  } catch (error) {
    console.error("Could not refresh Stripe onboarding:", error);
    return new Response("Could not refresh onboarding. Please try again.", {
      status: 503,
    });
  }
}
