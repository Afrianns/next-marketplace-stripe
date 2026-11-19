grant usage on schema public to service_role;

grant select, insert, update
  on public.listings
  to service_role;

grant select, insert, update
  on public.seller_accounts
  to service_role;

grant select, insert, update, delete
  on public.seller_email_verifications
  to service_role;

grant select, update
  on public.listing_orders
  to service_role;
