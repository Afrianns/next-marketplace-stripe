import { getStripe } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";

export type CheckoutStatus = "available" | "processing" | "sold";

export type CheckoutResolution = {
  listingId: string;
  status: CheckoutStatus;
};

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

async function getListingStatus(
  supabase: ReturnType<typeof createAdminClient>,
  listingId: string,
): Promise<CheckoutStatus> {
  const { data: listing, error } = await supabase
    .from("listings")
    .select("status")
    .eq("id", listingId)
    .maybeSingle();

  if (error) {
    throw new Error(`Could not check listing status: ${error.message}`);
  }
  if (!listing) {
    throw new Error("The checkout listing no longer exists.");
  }
  if (listing.status === "sold") {
    return "sold";
  }
  return listing.status === "available" ? "available" : "processing";
}

async function releaseReservation(
  supabase: ReturnType<typeof createAdminClient>,
  orderId: string,
  listingId: string,
): Promise<CheckoutResolution> {
  const { error } = await supabase.rpc(
    "release_listing_checkout_reservation",
    { p_order_id: orderId },
  );
  if (error) {
    throw new Error(`Could not release listing reservation: ${error.message}`);
  }

  return {
    listingId,
    status: await getListingStatus(supabase, listingId),
  };
}

export async function cancelCheckout(
  orderId: string,
): Promise<CheckoutResolution> {
  if (!isUuid(orderId)) {
    throw new Error("Invalid checkout order.");
  }

  const supabase = createAdminClient();
  const { data: order, error: orderError } = await supabase
    .from("listing_orders")
    .select(
      "listing_id,seller_account_id,status,stripe_checkout_session_id,amount_cents,currency,buyer_email",
    )
    .eq("id", orderId)
    .maybeSingle();

  if (orderError) {
    throw new Error(`Could not look up checkout order: ${orderError.message}`);
  }
  if (!order) {
    throw new Error("Checkout order not found.");
  }

  if (order.status === "paid") {
    return { listingId: order.listing_id, status: "sold" };
  }
  if (order.status === "failed") {
    return {
      listingId: order.listing_id,
      status: await getListingStatus(supabase, order.listing_id),
    };
  }
  if (!order.stripe_checkout_session_id) {
    return releaseReservation(supabase, orderId, order.listing_id);
  }

  const stripe = getStripe();
  const stripeOptions = { stripeAccount: order.seller_account_id };
  let session = await stripe.checkout.sessions.retrieve(
    order.stripe_checkout_session_id,
    {},
    stripeOptions,
  );

  if (session.status === "open") {
    try {
      session = await stripe.checkout.sessions.expire(
        session.id,
        {},
        stripeOptions,
      );
    } catch (expireError) {
      const latestSession = await stripe.checkout.sessions.retrieve(
        session.id,
        {},
        stripeOptions,
      );
      if (latestSession.status === "open") {
        throw expireError;
      }
      session = latestSession;
    }
  }

  if (session.status === "complete") {
    if (
      session.metadata?.order_id !== orderId ||
      session.amount_total !== order.amount_cents ||
      session.currency !== order.currency
    ) {
      throw new Error("Completed Checkout Session does not match its order.");
    }

    if (session.payment_status === "paid") {
      const paymentIntentId =
        typeof session.payment_intent === "string"
          ? session.payment_intent
          : session.payment_intent?.id ?? null;
      const { error: applyError } = await supabase.rpc(
        "apply_stripe_checkout_event",
        {
          p_event_id: `checkout-session-sync:${session.id}`,
          p_event_type: "checkout.session.completed",
          p_order_id: orderId,
          p_session_id: session.id,
          p_payment_intent_id: paymentIntentId,
          p_buyer_email:
            session.customer_details?.email ??
            session.customer_email ??
            order.buyer_email,
          p_payment_succeeded: true,
          p_connected_account_id: order.seller_account_id,
        },
      );
      if (applyError) {
        throw new Error(`Could not record completed payment: ${applyError.message}`);
      }

      return {
        listingId: order.listing_id,
        status: await getListingStatus(supabase, order.listing_id),
      };
    }

    const { error: updateError } = await supabase
      .from("listing_orders")
      .update({ status: "processing", updated_at: new Date().toISOString() })
      .eq("id", orderId)
      .in("status", ["pending", "processing"]);
    if (updateError) {
      throw new Error(`Could not update completed checkout order: ${updateError.message}`);
    }
    return { listingId: order.listing_id, status: "processing" };
  }
  if (session.status !== "expired") {
    throw new Error("Checkout Session could not be safely canceled.");
  }

  return releaseReservation(supabase, orderId, order.listing_id);
}

export async function releaseStaleCheckoutReservations() {
  const supabase = createAdminClient();
  const cutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const { data: orders, error } = await supabase
    .from("listing_orders")
    .select("id")
    .in("status", ["pending", "processing"])
    .lt("created_at", cutoff)
    .order("created_at", { ascending: true })
    .limit(20);

  if (error) {
    throw new Error(`Could not find stale checkout reservations: ${error.message}`);
  }

  const resolutions: CheckoutResolution[] = [];
  let failedCount = 0;
  for (const order of orders ?? []) {
    try {
      resolutions.push(await cancelCheckout(order.id));
    } catch (error) {
      failedCount += 1;
      console.error("Could not expire stale Checkout Session:", {
        orderId: order.id,
        error,
      });
    }
  }

  return {
    checked: orders?.length ?? 0,
    failedCount,
    resolutions,
  };
}
