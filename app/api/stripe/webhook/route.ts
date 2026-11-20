import Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendBuyerPurchaseReceipt } from "@/lib/marketplace-email";

const checkoutEventTypes = new Set([
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "checkout.session.expired",
]);

export async function POST(request: Request) {
  const signature = request.headers.get("stripe-signature");
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!signature || !webhookSecret) {
    return Response.json(
      { error: "Stripe webhook signature configuration is missing." },
      { status: 503 },
    );
  }

  let event: Stripe.Event;
  try {
    const body = await request.text();
    event = getStripe().webhooks.constructEvent(body, signature, webhookSecret);
  } catch (error) {
    console.error("Could not verify Stripe webhook signature:", error);
    return Response.json({ error: "Invalid Stripe webhook signature." }, { status: 400 });
  }

  if (!checkoutEventTypes.has(event.type)) {
    return Response.json({ received: true, ignored: true });
  }

  const connectedAccountId = event.account;
  if (
    typeof connectedAccountId !== "string" ||
    !/^acct_[A-Za-z0-9]+$/.test(connectedAccountId)
  ) {
    console.error("Stripe Connect Checkout event has no valid connected account.", {
      eventId: event.id,
    });
    return Response.json({ error: "Missing connected account context." }, { status: 400 });
  }

  const session = event.data.object as Stripe.Checkout.Session;
  const orderId = session.metadata?.order_id;
  if (!orderId) {
    return Response.json({ received: true, ignored: true });
  }
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      orderId,
    )
  ) {
    console.error("Stripe Checkout Session has an invalid order ID.", {
      eventId: event.id,
    });
    return Response.json({ error: "Invalid order metadata." }, { status: 400 });
  }

  const paymentIntentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id ?? null;
  const buyerEmail =
    session.customer_details?.email ?? session.customer_email ?? null;
  const paymentSucceeded =
    session.payment_status === "paid" &&
    (event.type === "checkout.session.completed" ||
      event.type === "checkout.session.async_payment_succeeded");

  try {
    const supabase = createAdminClient();
    const { error } = await supabase.rpc("apply_stripe_checkout_event", {
      p_event_id: event.id,
      p_event_type: event.type,
      p_order_id: orderId,
      p_session_id: session.id,
      p_payment_intent_id: paymentIntentId,
      p_buyer_email: buyerEmail,
      p_payment_succeeded: paymentSucceeded,
      p_connected_account_id: connectedAccountId,
    });

    if (error) {
      console.error("Could not apply Stripe Checkout webhook:", error);
      return Response.json(
        { error: "Could not update the order from Stripe’s event." },
        { status: 500 },
      );
    }

    if (paymentSucceeded) {
      const { data: order, error: orderError } = await supabase
        .from("listing_orders")
        .select("id,listing_id,buyer_email,amount_cents,currency")
        .eq("id", orderId)
        .maybeSingle();
      if (orderError || !order) {
        console.error("Could not load paid order for buyer receipt:", orderError);
        return Response.json(
          { error: "Could not load order details for the buyer receipt." },
          { status: 500 },
        );
      }

      const { data: listing, error: listingError } = await supabase
        .from("listings")
        .select("title,description,category,location")
        .eq("id", order.listing_id)
        .maybeSingle();
      if (listingError || !listing) {
        console.error("Could not load purchased listing for buyer receipt:", listingError);
        return Response.json(
          { error: "Could not load product details for the buyer receipt." },
          { status: 500 },
        );
      }

      const invoiceId =
        typeof session.invoice === "string"
          ? session.invoice
          : session.invoice?.id ?? null;
      let invoicePdfUrl: string | null = null;
      let hostedInvoiceUrl: string | null = null;
      if (invoiceId) {
        const invoice = await getStripe().invoices.retrieve(
          invoiceId,
          {},
          { stripeAccount: connectedAccountId },
        );
        invoicePdfUrl = invoice.invoice_pdf ?? null;
        hostedInvoiceUrl = invoice.hosted_invoice_url ?? null;
      }

      await sendBuyerPurchaseReceipt({
        email: order.buyer_email,
        listingTitle: listing.title,
        listingDescription: listing.description,
        listingCategory: listing.category,
        listingLocation: listing.location,
        amountCents: order.amount_cents,
        currency: order.currency,
        orderId: order.id,
        invoicePdfUrl,
        hostedInvoiceUrl,
      });
    }

    return Response.json({ received: true });
  } catch (error) {
    console.error("Stripe Checkout webhook processing failed:", error);
    return Response.json(
      { error: "Webhook processing is not configured on the server." },
      { status: 503 },
    );
  }
}
