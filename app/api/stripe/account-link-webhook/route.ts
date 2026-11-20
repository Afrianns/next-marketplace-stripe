import Stripe from "stripe";
import { syncSellerAccount } from "@/lib/connect";
import { getStripe } from "@/lib/stripe";

export async function POST(request: Request) {
  const signature = request.headers.get("stripe-signature");
  const webhookSecret = process.env.STRIPE_ACCOUNT_LINK_WEBHOOK_SECRET;
  if (!signature || !webhookSecret) {
    return Response.json(
      { error: "Stripe account link webhook signature configuration is missing." },
      { status: 503 },
    );
  }

  let notification: Stripe.V2.Core.EventNotification;
  try {
    notification = getStripe().parseEventNotification(
      await request.text(),
      signature,
      webhookSecret,
    );
  } catch (error) {
    console.error("Could not verify Stripe account link webhook signature:", error);
    return Response.json(
      { error: "Invalid Stripe account link webhook signature." },
      { status: 400 },
    );
  }

  if (notification.type !== "v2.core.account_link.returned") {
    return Response.json({ received: true, ignored: true });
  }

  try {
    const event = await notification.fetchEvent();
    const accountId = event.data.account_id;
    if (!/^acct_[A-Za-z0-9]+$/.test(accountId)) {
      console.error("Stripe AccountLink return event has an invalid account ID.", {
        eventId: event.id,
      });
      return Response.json({ error: "Invalid connected account context." }, { status: 400 });
    }

    await syncSellerAccount(accountId);
    return Response.json({ received: true });
  } catch (error) {
    console.error("Could not sync seller from Stripe AccountLink return event:", {
      eventId: notification.id,
      error,
    });
    return Response.json(
      { error: "Could not update seller onboarding status." },
      { status: 500 },
    );
  }
}
