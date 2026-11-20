import Stripe from "stripe";
import { syncSellerAccount } from "@/lib/connect";
import { getStripe } from "@/lib/stripe";

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
    notification = getStripe().parseEventNotification(
      await request.text(),
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

  let accountId: string;
  switch (notification.type) {
    case "v2.core.account.updated":
    case "v2.core.account[configuration.merchant].capability_status_updated":
    case "v2.core.account[configuration.merchant].updated":
    case "v2.core.account[requirements].updated":
      accountId = notification.related_object.id;
      break;
    default:
      return Response.json({ received: true, ignored: true });
  }

  if (!/^acct_[A-Za-z0-9]+$/.test(accountId)) {
    console.error("Stripe account event has an invalid related account ID.", {
      eventId: notification.id,
      eventType: notification.type,
    });
    return Response.json({ error: "Invalid connected account context." }, { status: 400 });
  }

  try {
    const seller = await syncSellerAccount(accountId);
    if (!seller) {
      console.warn("Stripe account event did not match a saved seller account.", {
        eventId: notification.id,
        accountId,
      });
    }
    return Response.json({ received: true });
  } catch (error) {
    console.error("Could not sync seller from Stripe account event:", {
      eventId: notification.id,
      eventType: notification.type,
      accountId,
      error,
    });
    return Response.json(
      { error: "Could not update seller onboarding status." },
      { status: 500 },
    );
  }
}
