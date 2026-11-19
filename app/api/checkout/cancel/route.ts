import { cancelCheckout } from "@/lib/checkout-reservations";
import { isSameOriginRequest } from "@/lib/http";

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function checkoutReturnUrl(
  siteUrl: string,
  resolution: Awaited<ReturnType<typeof cancelCheckout>>,
) {
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
