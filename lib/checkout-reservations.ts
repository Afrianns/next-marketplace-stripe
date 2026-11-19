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
    .select("listing_id,seller_account_id,status,stripe_checkout_session_id")
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
    .eq("status", "pending")
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
