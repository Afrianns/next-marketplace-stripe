# fairground marketplace

A no-login marketplace with seller email verification, Stripe Connect onboarding,
Stripe Checkout, and webhook-driven order status.

## Local setup

Install dependencies and start the development server:

```bash
npm install
npm run dev
```

Set these variables in `.env` and in the deployment environment. Keep all values
server-only; never expose secret keys with a `NEXT_PUBLIC_` prefix.

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SERVICE_ROLE_KEY=
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
SELLER_VERIFICATION_SECRET=
SITE_URL=http://localhost:3000
GMAIL_USER=
GMAIL_APP_PASSWORD=
```

`SELLER_VERIFICATION_SECRET` should be a long, random value. Gmail sends the
one-time seller email codes and, when available, Stripe onboarding links.

## Supabase

Apply the migrations in order using the Supabase SQL Editor:

1. `supabase/migrations/20261118000000_create_marketplace_tables.sql`
2. `supabase/migrations/20261119000000_add_stripe_connect_payments.sql`
3. `supabase/migrations/20261119020000_grant_server_api_privileges.sql`
4. `supabase/migrations/20261119023000_allow_consumed_email_verification_codes.sql`
5. `supabase/migrations/20261119030000_use_managed_risk_direct_charges.sql`

The second migration adds seller account records, listing/payment states, order
and webhook tables, and server-only functions for seller verification and atomic
listing reservation. Public catalog reads exclude seller email, address, and
phone. Listing creation and payment state changes are performed by server APIs.
The third grants the server-only `service_role` the table privileges those APIs
need without widening access for `anon` or `authenticated`.
The fourth allows a successfully used verification code to be cleared.
The fifth adds direct-charge readiness state and binds Connect webhook events
to the connected account that created each order.

Existing sample listings can still be displayed, but must be associated with an
onboarded seller account before checkout can be enabled for them.

## Stripe

Configure Stripe Connect for the platform and set `STRIPE_SECRET_KEY` and
`SITE_URL`. This integration uses Accounts v2 merchant accounts with the
`card_payments` capability, Stripe-managed losses, and direct charges. Seller
emails are verified before they can be associated with a Connect account. A
verified email already present in the local `seller_accounts` table reuses that
account; fully onboarded sellers skip onboarding. Other sellers receive
Stripe-hosted onboarding. A listing is shown only after Stripe reports active
card-payments capability and no outstanding requirements.

Create a Connect webhook endpoint that listens to events from **connected
accounts** at:

```text
https://your-domain.example/api/stripe/webhook
```

Subscribe it to these Checkout events and set that endpoint's signing secret as
`STRIPE_WEBHOOK_SECRET` in Vercel:

- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`
- `checkout.session.async_payment_failed`
- `checkout.session.expired`

The Buy now flow creates a one-time USD Checkout Session directly on the seller's
connected account, reserves the listing, and collects a 10% application fee for
the platform. Stripe deducts processing fees from the seller's charge. A verified
Connect webhook records payment in Supabase and marks the listing sold;
expiration or failed asynchronous payment releases the reservation. Webhook
signatures, connected-account ownership, and duplicate event IDs are checked
server-side.

Sellers receive the remaining funds in their Stripe balance and are paid out
according to their Stripe payout schedule. This is a direct-charge model; the
platform does not hold seller proceeds for later transfers.

Before production, confirm with Stripe that the platform account is eligible
and activated for Connect, charges, and payouts in the countries you plan to
support. The implementation currently requires a two-letter seller country code
and prices in USD; Stripe country and cross-border availability must be
confirmed for the actual platform and seller locations.
