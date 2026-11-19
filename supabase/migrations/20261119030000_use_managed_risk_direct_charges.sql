alter table public.seller_accounts
  add column if not exists card_payments_status text not null default 'pending';

drop function if exists public.apply_stripe_checkout_event(
  text, text, uuid, text, text, text, boolean
);

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
