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

The second migration adds seller account records, listing/payment states, order
and webhook tables, and server-only functions for seller verification and atomic
listing reservation. Public catalog reads exclude seller email, address, and
phone. Listing creation and payment state changes are performed by server APIs.

Existing sample listings can still be displayed, but must be associated with an
onboarded seller account before checkout can be enabled for them.

## Stripe

Configure Stripe Connect for the platform and set `STRIPE_SECRET_KEY` and
`SITE_URL`. Seller emails are verified before they can be associated with a
Connect account. A verified email already present in the local
`seller_accounts` table reuses that account; fully onboarded sellers skip
onboarding. Other sellers receive Stripe-hosted onboarding. A listing is shown
only after Stripe reports active transfer capability and no outstanding
requirements.

Create a webhook endpoint at:

```text
https://your-domain.example/api/stripe/webhook
```

Subscribe it to these Checkout events and set the endpoint signing secret as
`STRIPE_WEBHOOK_SECRET`:

- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`
- `checkout.session.async_payment_failed`
- `checkout.session.expired`

The Buy now flow creates a one-time USD Checkout Session and reserves the
listing. A verified webhook records payment in Supabase and marks the listing
sold; expiration or failed asynchronous payment releases the reservation.
Webhook signatures and duplicate event IDs are checked server-side.

The current platform fee is 10%. Seller transfers are intentionally not
implemented yet, so paid orders require a separate settlement/fulfillment
process before sellers receive funds.

Before production, confirm with Stripe that the platform account is eligible
and activated for Connect, charges, and payouts in the countries you plan to
support. The implementation currently requires a two-letter seller country code
and prices in USD; Stripe country and cross-border availability must be
confirmed for the actual platform and seller locations.
