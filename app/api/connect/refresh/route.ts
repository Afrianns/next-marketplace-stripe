import { createConnectedAccountLink } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { hashSellerVerificationToken, safeHashEquals } from "@/lib/seller-verification";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const accountId = url.searchParams.get("account") ?? "";
  const token = url.searchParams.get("token") ?? "";
  if (!/^acct_[A-Za-z0-9]+$/.test(accountId) || token.length < 40) {
    return new Response("Invalid onboarding refresh link.", { status: 400 });
  }

  try {
    const supabase = createAdminClient();
    const { data: seller, error } = await supabase
      .from("seller_accounts")
      .select("onboarding_refresh_token_hash, onboarding_complete")
      .eq("stripe_account_id", accountId)
      .maybeSingle();

    if (error) {
      console.error("Could not look up seller for onboarding refresh:", error);
      return new Response("Could not refresh onboarding. Please try again.", {
        status: 500,
      });
    }
    if (
      !seller ||
      seller.onboarding_complete ||
      !seller.onboarding_refresh_token_hash ||
      !safeHashEquals(
        seller.onboarding_refresh_token_hash,
        hashSellerVerificationToken(token),
      )
    ) {
      return new Response("This onboarding link is invalid or no longer needed.", {
        status: 403,
      });
    }

    const link = await createConnectedAccountLink(accountId, token);
    return Response.redirect(link.url, 303);
  } catch (error) {
    console.error("Could not refresh Stripe onboarding:", error);
    return new Response("Could not refresh onboarding. Please try again.", {
      status: 503,
    });
  }
}
