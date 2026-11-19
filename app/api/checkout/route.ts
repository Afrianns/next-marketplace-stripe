import { randomInt, randomUUID } from "node:crypto";
import { syncSellerAccount } from "@/lib/connect";
import { isSameOriginRequest, isValidEmail } from "@/lib/http";
import { getStripe } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";

type CheckoutRequest = {
  listingId?: unknown;
  buyerEmail?: unknown;
};

function randomLetters(length: number) {
  return Array.from({ length }, () =>
    String.fromCharCode(97 + randomInt(26)),
  ).join("");
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return Response.json({ error: "Invalid request origin." }, { status: 403 });
  }

  let payload: CheckoutRequest;
  try {
    payload = (await request.json()) as CheckoutRequest;
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  const listingId =
    typeof payload.listingId === "string" ? payload.listingId.trim() : "";
  const buyerEmail =
    typeof payload.buyerEmail === "string"
      ? payload.buyerEmail.trim().toLowerCase()
      : "";
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      listingId,
    ) ||
    !isValidEmail(buyerEmail)
  ) {
    return Response.json(
      { error: "Enter a valid buyer email and listing." },
      { status: 400 },
    );
  }

  const siteUrl = process.env.SITE_URL;
  if (!siteUrl) {
    return Response.json(
      { error: "SITE_URL is not configured on the server." },
      { status: 503 },
    );
  }

  try {
    const supabase = createAdminClient();
    const { data: listing, error: listingError } = await supabase
      .from("listings")
      .select("id, title, price, seller_email, status")
      .eq("id", listingId)
      .maybeSingle();

    if (listingError) {
      console.error("Could not look up listing for checkout:", listingError);
      return Response.json(
        { error: "Could not start checkout. Please try again." },
        { status: 500 },
      );
    }
    if (!listing) {
      return Response.json({ error: "This listing no longer exists." }, { status: 404 });
    }
    if (listing.status !== "available") {
      return Response.json(
        { error: "This listing is not available for purchase." },
        { status: 409 },
      );
    }

    const { data: seller, error: sellerError } = await supabase
      .from("seller_accounts")
      .select("stripe_account_id")
      .eq("email", listing.seller_email.toLowerCase())
      .maybeSingle();

    if (sellerError) {
      console.error("Could not look up seller for checkout:", sellerError);
      return Response.json(
        { error: "Could not verify seller onboarding. Please try again." },
        { status: 500 },
      );
    }
    if (!seller) {
      return Response.json(
        { error: "The seller has not completed Stripe onboarding." },
        { status: 409 },
      );
    }

    const readiness = await syncSellerAccount(seller.stripe_account_id);
    if (!readiness?.complete) {
      return Response.json(
        { error: "The seller must finish Stripe onboarding before checkout." },
        { status: 409 },
      );
    }

    const amountCents = Math.round(Number(listing.price) * 100);
    if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
      return Response.json(
        { error: "This listing has an invalid price." },
        { status: 409 },
      );
    }
    const platformFeeCents = Math.round(amountCents * 0.1);
    const orderId = randomUUID();
    const { data: reservation, error: reservationError } = await supabase.rpc(
      "reserve_listing_for_checkout",
      {
        p_listing_id: listing.id,
        p_order_id: orderId,
        p_buyer_email: buyerEmail,
        p_platform_fee_cents: platformFeeCents,
      },
    );

    if (reservationError || !reservation?.[0]) {
      const reason = reservationError?.message ?? "";
      if (reason.includes("listing_not_found")) {
        return Response.json({ error: "This listing no longer exists." }, { status: 404 });
      }
      if (
        reason.includes("listing_not_available") ||
        reason.includes("seller_not_ready")
      ) {
        return Response.json(
          { error: "This listing is no longer available for purchase." },
          { status: 409 },
        );
      }
      console.error("Could not reserve listing for checkout:", reservationError);
      return Response.json(
        { error: "Could not reserve this listing. Please try again." },
        { status: 500 },
      );
    }

    const baseUrl = new URL(siteUrl);
    const successUrl = new URL("/checkout/success", baseUrl);
    successUrl.searchParams.set("session_id", "{CHECKOUT_SESSION_ID}");
    const cancelUrl = new URL("/api/checkout/cancel", baseUrl);
    cancelUrl.searchParams.set("order_id", orderId);
    let session;
    try {
      session = await getStripe().checkout.sessions.create(
        {
          mode: "payment",
          client_reference_id: orderId,
          customer_email: buyerEmail,
          expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
          integration_identifier: `marketplace_${randomLetters(8)}`,
          line_items: [
            {
              quantity: 1,
              price_data: {
                currency: "usd",
                unit_amount: reservation[0].amount_cents,
                product_data: { name: listing.title },
              },
            },
          ],
          metadata: { order_id: orderId },
          payment_intent_data: {
            ...(platformFeeCents > 0
              ? {
                  application_fee_amount: platformFeeCents,
                }
              : {}),
            metadata: { order_id: orderId },
          },
          success_url: successUrl.toString(),
          cancel_url: cancelUrl.toString(),
        },
        {
          idempotencyKey: `checkout-${orderId}`,
          stripeAccount: seller.stripe_account_id,
        },
      );
    } catch (error) {
      const { error: releaseError } = await supabase.rpc(
        "release_listing_checkout_reservation",
        { p_order_id: orderId },
      );
      if (releaseError) {
        console.error("Could not release failed checkout reservation:", releaseError);
      }
      console.error("Could not create Stripe Checkout Session:", error);
      return Response.json(
        { error: "Stripe could not start checkout. Please try again." },
        { status: 502 },
      );
    }

    if (!session.url) {
      const { error: releaseError } = await supabase.rpc(
        "release_listing_checkout_reservation",
        { p_order_id: orderId },
      );
      if (releaseError) {
        console.error("Could not release checkout without a URL:", releaseError);
      }
      return Response.json(
        { error: "Stripe did not return a Checkout URL." },
        { status: 502 },
      );
    }

    const { error: sessionSaveError } = await supabase
      .from("listing_orders")
      .update({ stripe_checkout_session_id: session.id })
      .eq("id", orderId);

    if (sessionSaveError) {
      console.error("Could not save Checkout Session:", sessionSaveError);
      try {
        await getStripe().checkout.sessions.expire(
          session.id,
          {},
          { stripeAccount: seller.stripe_account_id },
        );
        await supabase.rpc("release_listing_checkout_reservation", {
          p_order_id: orderId,
        });
      } catch (error) {
        console.error("Could not expire untracked Checkout Session:", error);
      }
      return Response.json(
        { error: "Could not prepare checkout. Please try again." },
        { status: 500 },
      );
    }

    return Response.json({ checkoutUrl: session.url, orderId });
  } catch (error) {
    console.error("Could not start marketplace checkout:", error);
    return Response.json(
      { error: "Checkout is not configured on the server." },
      { status: 503 },
    );
  }
}
