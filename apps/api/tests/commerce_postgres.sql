-- Run with: psql -X -v ON_ERROR_STOP=1 postgres -f apps/api/tests/commerce_postgres.sql
-- The entire fixture and both migrations are rolled back.
begin;
create schema auth;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean);
do $$ begin
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role; end if;
end $$;
\i supabase/migrations/20261014000100_phase_01.sql
\i supabase/migrations/20261016000100_phase_02_commerce.sql

insert into auth.users values ('00000000-0000-0000-0000-000000000001'),('00000000-0000-0000-0000-000000000002');
insert into public.tenants (id,name) values
  ('10000000-0000-0000-0000-000000000001','A'),
  ('10000000-0000-0000-0000-000000000002','B');
insert into public.memberships (tenant_id,user_id,role) values
  ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','owner'),
  ('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000002','owner');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);

do $$ declare tenant uuid := '10000000-0000-0000-0000-000000000001';
  product uuid; variant uuid; v_order_id uuid;
begin
  perform public.pulse_set_currency(tenant,'USD');
  product := public.pulse_save_product(tenant,null,'sample','Sample','Tops','Test',
    '[{"url":"https://example.com/image.jpg"}]',null,'active',
    '[{"sku":"SKU-1","options":{},"regular_price_minor":1200,"offer_price_minor":1000,"stock":5}]');
  select id into variant from public.product_variants where product_id=product;
  v_order_id := public.pulse_save_order(tenant,null,'Ada','555','Main St','none',0,0,
    jsonb_build_array(jsonb_build_object('variant_id',variant,'quantity',2)));
  perform public.pulse_order_action(v_order_id,'submit',null);
  perform public.pulse_order_action(v_order_id,'confirm',null);
  if (select stock from public.product_variants where id=variant) <> 3 then raise exception 'Stock not reserved'; end if;
  perform public.pulse_record_payment(v_order_id,500,'cash','Deposit');
  perform public.pulse_order_action(v_order_id,'cancel','Customer request');
  if (select stock from public.product_variants where id=variant) <> 5 then raise exception 'Stock not restored'; end if;
  if (select count(*) from public.commerce_payments p where p.order_id=v_order_id) <> 1 then raise exception 'Payment lost'; end if;
  begin
    perform public.pulse_order_action(v_order_id,'cancel','Again');
    raise exception 'Duplicate cancellation accepted';
  exception when invalid_parameter_value then null;
  end;
  if public.pulse_remove_product(product) <> 'archived' then raise exception 'Referenced product removed'; end if;
  perform public.pulse_restore_product(product);
  if (select state from public.products where id=product) <> 'draft' then raise exception 'Restore failed'; end if;
  begin
    perform public.pulse_set_currency(tenant,'EUR');
    raise exception 'Currency changed after data';
  exception when invalid_parameter_value then null;
  end;
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',true);
  begin
    perform public.pulse_adjust_stock(variant,1,'Cross tenant');
    raise exception 'Cross tenant stock adjustment accepted';
  exception when insufficient_privilege then null;
  end;
end $$;
rollback;
