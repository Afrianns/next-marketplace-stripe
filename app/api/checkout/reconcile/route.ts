import { isSameOriginRequest } from "@/lib/http";
import { releaseStaleCheckoutReservations } from "@/lib/checkout-reservations";

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return Response.json({ error: "Invalid request origin." }, { status: 403 });
  }

  try {
    const result = await releaseStaleCheckoutReservations();
    return Response.json(result);
  } catch (error) {
    console.error("Could not reconcile stale checkout reservations:", error);
    return Response.json(
      { error: "Could not refresh checkout reservations." },
      { status: 503 },
    );
  }
}
