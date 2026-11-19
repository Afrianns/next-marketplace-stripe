alter table public.listings
  add column if not exists seller_country char(2),
  add column if not exists status text not null default 'available'
    check (status in ('pending_onboarding', 'available', 'reserved', 'sold')),
  add column if not exists reserved_order_id uuid,
  add column if not exists sold_at timestamptz;

alter table public.listings
  alter column seller_address drop not null,
  alter column seller_phone drop not null;

create table if not exists public.seller_accounts (
  email text primary key check (email = lower(btrim(email))),
  stripe_account_id text not null unique,
  country char(2) not null,
  onboarding_complete boolean not null default false,
  card_payments_status text not null default 'pending',
  requirements_count integer not null default 0 check (requirements_count >= 0),
  onboarding_refresh_token_hash text,
  updated_at timestamptz not null default now()
);

create table if not exists public.listing_orders (
  id uuid primary key,
  listing_id uuid not null references public.listings(id),
  seller_account_id text not null references public.seller_accounts(stripe_account_id),
  buyer_email text not null check (char_length(btrim(buyer_email)) between 3 and 320),
  amount_cents integer not null check (amount_cents > 0),
  platform_fee_cents integer not null check (
    platform_fee_cents >= 0 and platform_fee_cents <= amount_cents
  ),
  seller_amount_cents integer not null check (
    seller_amount_cents = amount_cents - platform_fee_cents
  ),
  currency text not null default 'usd' check (currency = 'usd'),
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'paid', 'failed')),
  stripe_checkout_session_id text unique,
  stripe_payment_intent_id text,
  transfer_group text not null unique,
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.listings
  add constraint listings_reserved_order_id_fkey
  foreign key (reserved_order_id)
  references public.listing_orders(id);

create unique index if not exists listing_orders_one_open_per_listing_idx
  on public.listing_orders (listing_id)
  where status in ('pending', 'processing', 'paid');

create table if not exists public.seller_email_verifications (
  email text primary key check (email = lower(btrim(email))),
  code_hash text,
  expires_at timestamptz not null,
  attempts integer not null default 0 check (attempts >= 0),
  last_sent_at timestamptz not null,
  verification_token_hash text,
  verified_until timestamptz
);

create table if not exists public.stripe_webhook_events (
  event_id text primary key,
  processed_at timestamptz not null default now()
);

alter table public.seller_accounts enable row level security;
alter table public.listing_orders enable row level security;
alter table public.seller_email_verifications enable row level security;
alter table public.stripe_webhook_events enable row level security;

revoke all on public.seller_accounts from anon, authenticated;
revoke all on public.listing_orders from anon, authenticated;
revoke all on public.seller_email_verifications from anon, authenticated;
revoke all on public.stripe_webhook_events from anon, authenticated;

revoke insert on public.listings from anon, authenticated;
drop policy if exists "Anyone can create marketplace listings" on public.listings;
revoke select on public.listings from anon, authenticated;
grant select (
  id,
  title,
  price,
  category,
  location,
  seller_name,
  description,
  image_path,
  created_at,
  status,
  sold_at
) on public.listings to anon, authenticated;

create or replace function public.verify_seller_email_code(
  p_email text,
  p_code_hash text,
  p_token_hash text,
  p_now timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  verification public.seller_email_verifications%rowtype;
begin
  select *
    into verification
    from public.seller_email_verifications
    where email = p_email
    for update;

  if not found
    or verification.expires_at <= p_now
    or verification.attempts >= 5
    or verification.code_hash is null then
    return false;
  end if;

  if verification.code_hash <> p_code_hash then
    update public.seller_email_verifications
      set attempts = attempts + 1
      where email = p_email;
    return false;
  end if;

  update public.seller_email_verifications
    set code_hash = null,
        verification_token_hash = p_token_hash,
        verified_until = p_now + interval '1 hour',
        attempts = 0
    where email = p_email;

  return true;
end;
$$;

revoke all on function public.verify_seller_email_code(text, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.verify_seller_email_code(text, text, text, timestamptz)
  to service_role;

create or replace function public.reserve_listing_for_checkout(
  p_listing_id uuid,
  p_order_id uuid,
  p_buyer_email text,
  p_platform_fee_cents integer
)
returns table (
  order_id uuid,
  amount_cents integer,
  seller_account_id text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  listing public.listings%rowtype;
  seller public.seller_accounts%rowtype;
  listing_amount_cents integer;
begin
  select *
    into listing
    from public.listings
    where id = p_listing_id
    for update;

  if not found then
    raise exception 'listing_not_found';
  end if;

  if listing.status <> 'available' then
    raise exception 'listing_not_available';
  end if;

  if listing.price <= 0 then
    raise exception 'listing_price_invalid';
  end if;

  select *
    into seller
    from public.seller_accounts
    where email = lower(btrim(listing.seller_email))
    for share;

  if not found or not seller.onboarding_complete then
    raise exception 'seller_not_ready';
  end if;

  listing_amount_cents := round(listing.price * 100)::integer;
  if p_platform_fee_cents < 0 or p_platform_fee_cents > listing_amount_cents then
    raise exception 'platform_fee_invalid';
  end if;

  insert into public.listing_orders (
    id,
    listing_id,
    seller_account_id,
    buyer_email,
    amount_cents,
    platform_fee_cents,
    seller_amount_cents,
    transfer_group
  )
  values (
    p_order_id,
    listing.id,
    seller.stripe_account_id,
    lower(btrim(p_buyer_email)),
    listing_amount_cents,
    p_platform_fee_cents,
    listing_amount_cents - p_platform_fee_cents,
    'listing_' || p_order_id::text
  );

  update public.listings
    set status = 'reserved',
        reserved_order_id = p_order_id
    where id = listing.id;

  return query
    select p_order_id, listing_amount_cents, seller.stripe_account_id;
end;
$$;

revoke all on function public.reserve_listing_for_checkout(uuid, uuid, text, integer)
  from public, anon, authenticated;
grant execute on function public.reserve_listing_for_checkout(uuid, uuid, text, integer)
  to service_role;

create or replace function public.release_listing_checkout_reservation(
  p_order_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_order public.listing_orders%rowtype;
begin
  select *
    into current_order
    from public.listing_orders
    where id = p_order_id
    for update;

  if not found or current_order.status not in ('pending', 'processing') then
    return false;
  end if;

  update public.listing_orders
    set status = 'failed',
        updated_at = now()
    where id = p_order_id;

  update public.listings
    set status = 'available',
        reserved_order_id = null
    where id = current_order.listing_id
      and reserved_order_id = p_order_id;

  return true;
end;
$$;

revoke all on function public.release_listing_checkout_reservation(uuid)
  from public, anon, authenticated;
grant execute on function public.release_listing_checkout_reservation(uuid)
  to service_role;

create or replace function public.apply_stripe_checkout_event(
  p_event_id text,
  p_event_type text,
  p_order_id uuid,
  p_session_id text,
  p_payment_intent_id text,
  p_buyer_email text,
  p_payment_succeeded boolean,
  p_connected_account_id text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_order public.listing_orders%rowtype;
  inserted_event integer;
begin
  insert into public.stripe_webhook_events (event_id)
    values (p_event_id)
    on conflict do nothing;
  get diagnostics inserted_event = row_count;

  if inserted_event = 0 then
    return false;
  end if;

  select *
    into current_order
    from public.listing_orders
    where id = p_order_id
    for update;

  if not found
    or p_connected_account_id is null
    or current_order.stripe_checkout_session_id is distinct from p_session_id
    or current_order.seller_account_id is distinct from p_connected_account_id then
    raise exception 'checkout_order_mismatch';
  end if;

  if current_order.status = 'paid' then
    return true;
  end if;

  if p_payment_succeeded then
    update public.listing_orders
      set status = 'paid',
          stripe_payment_intent_id = p_payment_intent_id,
          buyer_email = coalesce(nullif(lower(btrim(p_buyer_email)), ''), buyer_email),
          paid_at = coalesce(paid_at, now()),
          updated_at = now()
      where id = p_order_id;

    update public.listings
      set status = 'sold',
          sold_at = coalesce(sold_at, now()),
          reserved_order_id = null
      where id = current_order.listing_id
        and reserved_order_id = p_order_id;
  elsif p_event_type = 'checkout.session.completed' then
    update public.listing_orders
      set status = 'processing',
          stripe_payment_intent_id = p_payment_intent_id,
          buyer_email = coalesce(nullif(lower(btrim(p_buyer_email)), ''), buyer_email),
          updated_at = now()
      where id = p_order_id
        and status = 'pending';
  elsif p_event_type in (
    'checkout.session.async_payment_failed',
    'checkout.session.expired'
  ) then
    update public.listing_orders
      set status = 'failed',
          updated_at = now()
      where id = p_order_id
        and status in ('pending', 'processing');

    update public.listings
      set status = 'available',
          reserved_order_id = null
      where id = current_order.listing_id
        and reserved_order_id = p_order_id;
  end if;

  return true;
end;
$$;

revoke all on function public.apply_stripe_checkout_event(
  text, text, uuid, text, text, text, boolean, text
) from public, anon, authenticated;
grant execute on function public.apply_stripe_checkout_event(
  text, text, uuid, text, text, text, boolean, text
) to service_role;
