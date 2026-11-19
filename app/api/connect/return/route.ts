import { syncSellerAccount } from "@/lib/connect";

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
    const seller = await syncSellerAccount(accountId);
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
