import { syncSellerAccount } from "@/lib/connect";
import { createAdminClient } from "@/lib/supabase/admin";

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const accountId = url.searchParams.get("account") ?? "";
  const listingId = url.searchParams.get("listing_id");
  if (!/^acct_[A-Za-z0-9]+$/.test(accountId)) {
    return new Response("Invalid Stripe onboarding return.", { status: 400 });
  }
  if (listingId && !isUuid(listingId)) {
    return new Response("Invalid Stripe onboarding return.", { status: 400 });
  }

  const siteUrl = process.env.SITE_URL;
  if (!siteUrl) {
    return new Response("Set SITE_URL on the server.", { status: 503 });
  }

  try {
    const seller = await syncSellerAccount(accountId);
    if (seller && !seller.complete && listingId) {
      const supabase = createAdminClient();
      const { data: listing, error: lookupError } = await supabase
        .from("listings")
        .select("image_path")
        .eq("id", listingId)
        .eq("seller_email", seller.email)
        .eq("status", "pending_onboarding")
        .maybeSingle();

      if (lookupError) {
        throw new Error(`Could not look up pending listing: ${lookupError.message}`);
      }
      if (listing) {
        const { error: deleteError } = await supabase
          .from("listings")
          .delete()
          .eq("id", listingId)
          .eq("seller_email", seller.email)
          .eq("status", "pending_onboarding");
        if (deleteError) {
          throw new Error(`Could not remove incomplete listing: ${deleteError.message}`);
        }

        const { error: imageError } = await supabase.storage
          .from("marketplace-listings")
          .remove([listing.image_path]);
        if (imageError) {
          console.error("Could not remove image for incomplete listing:", imageError);
        }
      }
    }
    const destination = new URL("/", siteUrl);
    destination.searchParams.set(
      "connect",
      seller?.complete
        ? "complete"
        : seller && listingId
          ? "removed"
          : "pending",
    );
    return Response.redirect(destination, 303);
  } catch (error) {
    console.error("Could not confirm Stripe onboarding status:", error);
    const destination = new URL("/", siteUrl);
    destination.searchParams.set("connect", "check_failed");
    return Response.redirect(destination, 303);
  }
}
