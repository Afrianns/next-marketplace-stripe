import { createHash, randomBytes } from "node:crypto";
import type Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  connectApiVersion,
  getConnectedAccountReadiness,
  getStripe,
} from "@/lib/stripe";
import { normalizeEmail } from "@/lib/seller-verification";

const recipientConfiguration: Stripe.V2.Core.AccountCreateParams = {
  contact_email: "",
  display_name: "",
  identity: { country: "us" },
  dashboard: "express",
  defaults: {
    currency: "usd",
    responsibilities: {
      fees_collector: "application",
      losses_collector: "application",
    },
  },
  configuration: {
    recipient: {
      capabilities: {
        stripe_balance: {
          stripe_transfers: { requested: true },
        },
      },
    },
  },
  include: ["configuration.recipient", "identity", "requirements"],
};

export async function getOrCreateSellerAccount(
  email: string,
  sellerName: string,
  country: string,
) {
  const supabase = createAdminClient();
  const normalizedEmail = normalizeEmail(email);
  const normalizedCountry = country.toLowerCase();
  const { data: existing, error: lookupError } = await supabase
    .from("seller_accounts")
    .select("*")
    .eq("email", normalizedEmail)
    .maybeSingle();

  if (lookupError) {
    throw new Error(`Could not look up the seller's Stripe account: ${lookupError.message}`);
  }

  let accountId = existing?.stripe_account_id;
  if (existing && existing.country.toLowerCase() !== normalizedCountry) {
    throw new Error(
      "This verified email is already linked to a Stripe account in a different country.",
    );
  }

  if (!accountId) {
    const accountParams: Stripe.V2.Core.AccountCreateParams = {
      ...recipientConfiguration,
      contact_email: normalizedEmail,
      display_name: sellerName.trim(),
      identity: { country: normalizedCountry },
    };
    const idempotencyKey = createHash("sha256")
      .update(`${normalizedEmail}:${normalizedCountry}`)
      .digest("hex");
    const account = await getStripe().v2.core.accounts.create(accountParams, {
      apiVersion: connectApiVersion,
      idempotencyKey: `seller-${idempotencyKey}`,
    });
    accountId = account.id;

    const { error: insertError } = await supabase
      .from("seller_accounts")
      .insert({
        email: normalizedEmail,
        stripe_account_id: accountId,
        country: normalizedCountry,
        onboarding_complete: false,
        transfers_status: "pending",
        requirements_count: 0,
        onboarding_refresh_token_hash: null,
      });

    if (insertError) {
      const { data: racedAccount, error: racedLookupError } = await supabase
        .from("seller_accounts")
        .select("*")
        .eq("email", normalizedEmail)
        .maybeSingle();
      if (racedLookupError || !racedAccount) {
        throw new Error(
          `Could not save the seller's Stripe account: ${insertError.message}`,
        );
      }
      if (racedAccount.country.toLowerCase() !== normalizedCountry) {
        throw new Error(
          "This verified email is already linked to a Stripe account in a different country.",
        );
      }
      accountId = racedAccount.stripe_account_id;
    }
  }

  const readiness = await getConnectedAccountReadiness(accountId);
  const { error: updateError } = await supabase
    .from("seller_accounts")
    .update({
      onboarding_complete: readiness.complete,
      transfers_status: readiness.transfersStatus,
      requirements_count: readiness.requirementsCount,
      onboarding_refresh_token_hash: readiness.complete
        ? null
        : existing?.onboarding_refresh_token_hash ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("email", normalizedEmail);

  if (updateError) {
    throw new Error(`Could not save Stripe onboarding status: ${updateError.message}`);
  }

  const { error: listingsError } = await supabase
    .from("listings")
    .update({
      status: readiness.complete ? "available" : "pending_onboarding",
    })
    .eq("seller_email", normalizedEmail)
    .in("status", ["available", "pending_onboarding"]);

  if (listingsError) {
    throw new Error(`Could not update seller listing status: ${listingsError.message}`);
  }

  return {
    accountId,
    normalizedEmail,
    readiness,
    refreshToken: readiness.complete
      ? null
      : randomBytes(32).toString("base64url"),
  };
}

export async function syncSellerAccount(accountId: string) {
  const supabase = createAdminClient();
  const { data: seller, error: lookupError } = await supabase
    .from("seller_accounts")
    .select("email")
    .eq("stripe_account_id", accountId)
    .maybeSingle();

  if (lookupError) {
    throw new Error(`Could not find the connected seller: ${lookupError.message}`);
  }
  if (!seller) {
    return null;
  }

  const readiness = await getConnectedAccountReadiness(accountId);
  const { error: updateError } = await supabase
    .from("seller_accounts")
    .update({
      onboarding_complete: readiness.complete,
      transfers_status: readiness.transfersStatus,
      requirements_count: readiness.requirementsCount,
      onboarding_refresh_token_hash: readiness.complete ? null : undefined,
      updated_at: new Date().toISOString(),
    })
    .eq("stripe_account_id", accountId);

  if (updateError) {
    throw new Error(`Could not save Stripe onboarding status: ${updateError.message}`);
  }

  const { error: listingsError } = await supabase
    .from("listings")
    .update({
      status: readiness.complete ? "available" : "pending_onboarding",
    })
    .eq("seller_email", seller.email)
    .in("status", ["available", "pending_onboarding"]);

  if (listingsError) {
    throw new Error(`Could not update seller listing status: ${listingsError.message}`);
  }

  return { email: seller.email, ...readiness };
}
