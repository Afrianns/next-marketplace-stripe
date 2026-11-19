import { syncSellerAccount } from "@/lib/connect";

async function syncSellerAccountAfterOnboarding(accountId: string) {
  let seller = await syncSellerAccount(accountId);

  for (let attempt = 0; seller && !seller.complete && attempt < 3; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    seller = await syncSellerAccount(accountId);
  }

  return seller;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const accountId = url.searchParams.get("account") ?? "";
  if (!/^acct_[A-Za-z0-9]+$/.test(accountId)) {
    return new Response("Invalid Stripe onboarding return.", { status: 400 });
  }

  const siteUrl = process.env.SITE_URL;
  if (!siteUrl) {
    return new Response("Set SITE_URL on the server.", { status: 503 });
  }

  try {
    const seller = await syncSellerAccountAfterOnboarding(accountId);
    const destination = new URL("/", siteUrl);
    destination.searchParams.set("connect", seller?.complete ? "complete" : "pending");
    return Response.redirect(destination, 303);
  } catch (error) {
    console.error("Could not confirm Stripe onboarding status:", error);
    const destination = new URL("/", siteUrl);
    destination.searchParams.set("connect", "check_failed");
    return Response.redirect(destination, 303);
  }
}
