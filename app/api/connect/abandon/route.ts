import { cookies } from "next/headers";
import { syncSellerAccount } from "@/lib/connect";
import { isSameOriginRequest } from "@/lib/http";
import {
  hashSellerVerificationToken,
  sellerVerificationCookie,
} from "@/lib/seller-verification";
import { createAdminClient } from "@/lib/supabase/admin";

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return Response.json({ error: "Invalid request origin." }, { status: 403 });
  }

  let payload: { listingId?: unknown };
  try {
    payload = (await request.json()) as { listingId?: unknown };
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  const listingId = typeof payload.listingId === "string" ? payload.listingId : "";
  if (!isUuid(listingId)) {
    return Response.json({ error: "Invalid listing." }, { status: 400 });
  }

  try {
    const token = (await cookies()).get(sellerVerificationCookie)?.value;
    if (!token) {
      return Response.json({ error: "Seller verification expired." }, { status: 403 });
    }

    const supabase = createAdminClient();
    const { data: verification, error: verificationError } = await supabase
      .from("seller_email_verifications")
      .select("email")
      .eq("verification_token_hash", hashSellerVerificationToken(token))
      .gt("verified_until", new Date().toISOString())
      .maybeSingle();

    if (verificationError) {
      throw new Error(`Could not validate seller verification: ${verificationError.message}`);
    }
    if (!verification) {
      return Response.json({ error: "Seller verification expired." }, { status: 403 });
    }

    const { data: sellerAccount, error: sellerError } = await supabase
      .from("seller_accounts")
      .select("stripe_account_id")
      .eq("email", verification.email)
      .maybeSingle();
    if (sellerError) {
      throw new Error(`Could not look up seller account: ${sellerError.message}`);
    }
    if (!sellerAccount) {
      return Response.json({ error: "Seller account not found." }, { status: 404 });
    }

    const seller = await syncSellerAccount(sellerAccount.stripe_account_id);
    if (!seller || seller.complete) {
      return Response.json({ removed: false });
    }

    const { data: listing, error: listingError } = await supabase
      .from("listings")
      .select("image_path")
      .eq("id", listingId)
      .eq("seller_email", seller.email)
      .eq("status", "pending_onboarding")
      .maybeSingle();
    if (listingError) {
      throw new Error(`Could not look up pending listing: ${listingError.message}`);
    }
    if (!listing) {
      return Response.json({ removed: false });
    }

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

    return Response.json({ removed: true });
  } catch (error) {
    console.error("Could not reconcile returned seller onboarding:", error);
    return Response.json(
      { error: "Could not verify Stripe onboarding status." },
      { status: 503 },
    );
  }
}
