import { getStripe } from "@/lib/stripe";
import { isSameOriginRequest } from "@/lib/http";
import { createAdminClient } from "@/lib/supabase/admin";

type CheckoutStatus = "available" | "processing" | "sold";

type CheckoutResolution = {
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

async function cancelCheckout(orderId: string): Promise<CheckoutResolution> {
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
    throw new Error("Checkout Session has not been saved for this order.");
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
    return { listingId: order.listing_id, status: "processing" };
  }
  if (session.status !== "expired") {
    throw new Error("Checkout Session could not be safely canceled.");
  }

  const { error: releaseError } = await supabase.rpc(
    "release_listing_checkout_reservation",
    { p_order_id: orderId },
  );
  if (releaseError) {
    throw new Error(`Could not release listing reservation: ${releaseError.message}`);
  }

  return {
    listingId: order.listing_id,
    status: await getListingStatus(supabase, order.listing_id),
  };
}

function checkoutReturnUrl(siteUrl: string, resolution: CheckoutResolution) {
  const destination = new URL("/", siteUrl);
  const checkout =
    resolution.status === "available"
      ? "cancelled"
      : resolution.status === "sold"
        ? "complete"
        : "processing";
  destination.searchParams.set("checkout", checkout);
  destination.searchParams.set("listing_id", resolution.listingId);
  return destination;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const orderId = url.searchParams.get("order_id") ?? "";
  const siteUrl = process.env.SITE_URL;
  if (!isUuid(orderId)) {
    return new Response("Invalid checkout order.", { status: 400 });
  }
  if (!siteUrl) {
    return new Response("Set SITE_URL on the server.", { status: 503 });
  }

  try {
    const resolution = await cancelCheckout(orderId);
    return Response.redirect(checkoutReturnUrl(siteUrl, resolution), 303);
  } catch (error) {
    console.error("Could not cancel marketplace checkout:", error);
    const destination = new URL("/", siteUrl);
    destination.searchParams.set("checkout", "cancel_failed");
    return Response.redirect(destination, 303);
  }
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return Response.json({ error: "Invalid request origin." }, { status: 403 });
  }

  let orderId = "";
  try {
    const payload = (await request.json()) as { orderId?: unknown };
    orderId = typeof payload.orderId === "string" ? payload.orderId : "";
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }
  if (!isUuid(orderId)) {
    return Response.json({ error: "Invalid checkout order." }, { status: 400 });
  }

  try {
    return Response.json(await cancelCheckout(orderId));
  } catch (error) {
    console.error("Could not cancel marketplace checkout:", error);
    return Response.json(
      { error: "Could not confirm checkout cancellation. Please try again." },
      { status: 503 },
    );
  }
}
