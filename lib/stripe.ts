import Stripe from "stripe";

const apiVersion = "2026-10-28.endive";
const connectApiVersion = "2026-10-28.preview";

let stripeClient: Stripe | undefined;

export function getStripe() {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    throw new Error("Set STRIPE_SECRET_KEY on the server.");
  }

  stripeClient ??= new Stripe(secretKey, { apiVersion });
  return stripeClient;
}

export async function getConnectedAccountReadiness(accountId: string) {
  const account = await getStripe().v2.core.accounts.retrieve(
    accountId,
    { include: ["configuration.merchant", "requirements"] },
    { apiVersion: connectApiVersion },
  );
  const cardPaymentsStatus =
    account.configuration?.merchant?.capabilities?.card_payments?.status ??
    "pending";
  const requirementsCount = account.requirements?.entries?.length ?? 0;

  return {
    complete: cardPaymentsStatus === "active" && requirementsCount === 0,
    cardPaymentsStatus,
    requirementsCount,
  };
}

export async function createConnectedAccountLink(
  accountId: string,
  refreshToken: string,
  listingId?: string,
) {
  const siteUrl = process.env.SITE_URL;
  if (!siteUrl) {
    throw new Error("Set SITE_URL to the deployed app origin.");
  }

  const baseUrl = new URL(siteUrl);
  const refreshUrl = new URL("/api/connect/refresh", baseUrl);
  refreshUrl.searchParams.set("account", accountId);
  refreshUrl.searchParams.set("token", refreshToken);
  if (listingId) refreshUrl.searchParams.set("listing_id", listingId);

  const returnUrl = new URL("/api/connect/return", baseUrl);
  returnUrl.searchParams.set("account", accountId);
  if (listingId) returnUrl.searchParams.set("listing_id", listingId);

  return getStripe().accountLinks.create({
    account: accountId,
    type: "account_onboarding",
    refresh_url: refreshUrl.toString(),
    return_url: returnUrl.toString(),
    collection_options: {
      fields: "eventually_due",
      future_requirements: "include",
    },
  });
}

export { connectApiVersion };
