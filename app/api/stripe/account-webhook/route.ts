import Stripe from "stripe";
import { syncSellerAccount } from "@/lib/connect";
import { getStripe } from "@/lib/stripe";

const accountReadinessEventTypes = new Set([
  "v2.core.account.updated",
  "v2.core.account[configuration.merchant].capability_status_updated",
  "v2.core.account[configuration.merchant].updated",
  "v2.core.account[requirements].updated",
]);

export async function POST(request: Request) {
  const signature = request.headers.get("stripe-signature");
  const webhookSecret = process.env.STRIPE_ACCOUNT_WEBHOOK_SECRET;
  if (!signature || !webhookSecret) {
    return Response.json(
      { error: "Stripe account webhook signature configuration is missing." },
      { status: 503 },
    );
  }

  let notification: Stripe.V2.Core.EventNotification;
  try {
    const body = await request.text();
    notification = getStripe().parseEventNotification(
      body,
      signature,
      webhookSecret,
    );
  } catch (error) {
    console.error("Could not verify Stripe account webhook signature:", error);
    return Response.json(
      { error: "Invalid Stripe account webhook signature." },
      { status: 400 },
    );
  }

  if (!accountReadinessEventTypes.has(notification.type)) {
    return Response.json({ received: true, ignored: true });
  }

  const accountId =
    "related_object" in notification ? notification.related_object.id : "";
  if (!/^acct_[A-Za-z0-9]+$/.test(accountId)) {
    console.error("Stripe account event has no valid related account ID.", {
      eventId: notification.id,
      eventType: notification.type,
    });
    return Response.json({ error: "Invalid connected account context." }, { status: 400 });
  }

  try {
    await syncSellerAccount(accountId);
    return Response.json({ received: true });
  } catch (error) {
    console.error("Could not sync seller from Stripe account webhook:", {
      eventId: notification.id,
      accountId,
      error,
    });
    return Response.json(
      { error: "Could not update seller onboarding status." },
      { status: 500 },
    );
  }
}
