-- Run with: psql -X -v ON_ERROR_STOP=1 postgres -f apps/api/tests/courier_postgres.sql
-- Courier handoff, partial-damage return, restock, loss report and tenant isolation; rolled back.
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
\i supabase/migrations/20261017000100_phase_03_agent.sql
\i supabase/migrations/20261017000200_phase_03_agent_versions.sql
\i supabase/migrations/20261017000300_phase_03_job_order.sql
\i supabase/migrations/20261017000400_phase_03_pause_jobs.sql
\i supabase/migrations/20261017000500_phase_04_analytics.sql
\i supabase/migrations/20261017000600_phase_04_inbox.sql
\i supabase/migrations/20261017000700_phase_04_activity.sql
\i supabase/migrations/20261017000800_phase_05_crm.sql
\i supabase/migrations/20261017000900_phase_05_manager_role.sql
\i supabase/migrations/20261017001000_phase_05_admin_agent.sql
\i supabase/migrations/20261017001100_phase_05_conversation_orders.sql
\i supabase/migrations/20261017001200_phase_05_customer_order_link.sql
\i supabase/migrations/20261017001300_phase_06_ops.sql
\i supabase/migrations/20261017001400_phase_06_usage.sql
\i supabase/migrations/20261017001500_phase_06_analytics_accuracy.sql
\i supabase/migrations/20261017001600_phase_06_agent_activity_fix.sql
\i supabase/migrations/20261105000100_phase_07_agent_orders.sql
\i supabase/migrations/20261106000100_phase_07_shipments_archive.sql

insert into auth.users values ('00000000-0000-0000-0000-000000000001'),('00000000-0000-0000-0000-000000000002');
insert into public.tenants (id,name) values
  ('10000000-0000-0000-0000-000000000001','A'),
  ('10000000-0000-0000-0000-000000000002','B');
insert into public.memberships (tenant_id,user_id,role) values
  ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','owner'),
  ('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000002','owner');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
do $$ declare tenant uuid := '10000000-0000-0000-0000-000000000001';
  product uuid; variant uuid; o uuid; o2 uuid; item uuid; s public.commerce_shipments; r jsonb;
begin
  perform public.pulse_set_currency(tenant,'BDT');
  product := public.pulse_save_product(tenant,null,'sample','Sample','Tops','Test',
    '[{"url":"https://example.com/image.jpg"}]',null,'active',
    '[{"sku":"SKU-1","options":{},"regular_price_minor":1200,"offer_price_minor":1000,"stock":10}]');
  select id into variant from public.product_variants where product_id=product;
  o := public.pulse_save_order(tenant,null,'Ada','555','Main St','none',0,0,
    jsonb_build_array(jsonb_build_object('variant_id',variant,'quantity',3)));
  perform public.pulse_order_action(o,'submit',null);
  perform public.pulse_order_action(o,'confirm',null);
  perform public.pulse_record_payment(o,500,'cash','Deposit');
  begin perform public.pulse_courier_handoff(tenant,o,'other',' ',null,null); raise exception 'other w/o name ok';
  exception when invalid_parameter_value then null; end;
  s := public.pulse_courier_handoff(tenant,o,'steadfast',null,'',12000);
  if s.state<>'booked' or s.cod_minor<>2500 or s.tracking_code is not null then raise exception 'handoff wrong %', row_to_json(s); end if;
  s := public.pulse_courier_handoff(tenant,o,'other','Local Rider Co','TRK9',10000);
  if s.provider<>'other' or s.courier_name<>'Local Rider Co' then raise exception 'edit wrong'; end if;
  s := public.pulse_courier_status(tenant,o,'in_transit');
  begin perform public.pulse_order_action(o,'cancel','x'); raise exception 'cancel while in transit';
  exception when invalid_parameter_value then null; end;
  select id into item from public.commerce_order_items where order_id=o;
  begin perform public.pulse_courier_return(tenant,o,jsonb_build_array(jsonb_build_object('item_id',item,'quantity',4)),0,null,null);
    raise exception 'over-damage ok'; exception when invalid_parameter_value then null; end;
  s := public.pulse_courier_return(tenant,o,jsonb_build_array(jsonb_build_object('item_id',item,'quantity',1)),80000,15000,'Customer refused');
  if s.state<>'returned' or s.delivery_fee_minor<>15000 then raise exception 'return wrong'; end if;
  if (select stock from public.product_variants where id=variant)<>9 then raise exception 'stock wrong %',(select stock from public.product_variants where id=variant); end if;
  if (select state::text from public.commerce_orders where id=o)<>'cancelled' then raise exception 'not cancelled'; end if;
  begin perform public.pulse_courier_status(tenant,o,'delivered'); raise exception 'status after return';
  exception when invalid_parameter_value then null; end;
  o2 := public.pulse_save_order(tenant,null,'Bo','556','2nd St','none',0,0,
    jsonb_build_array(jsonb_build_object('variant_id',variant,'quantity',1)));
  perform public.pulse_order_action(o2,'submit',null);
  perform public.pulse_order_action(o2,'confirm',null);
  perform public.pulse_courier_handoff(tenant,o2,'pathao',null,'P1',6000);
  perform public.pulse_courier_status(tenant,o2,'delivered');
  r := public.pulse_courier_returns_report(tenant,30);
  if jsonb_array_length(r->'couriers')<>2 or jsonb_array_length(r->'returns')<>1 then raise exception 'report shape'; end if;
  if (r->'couriers'->0->>'damage_loss_minor')::bigint<>80000 or (r->'couriers'->0->>'delivery_fees_lost_minor')::bigint<>15000
     or (r->'couriers'->0->>'sale_value_lost_minor')::bigint<>3000 then raise exception 'report totals'; end if;
  perform public.pulse_archive_order(tenant,o,true);
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',true);
  begin perform public.pulse_courier_returns_report(tenant,30); raise exception 'cross tenant report';
  exception when insufficient_privilege then null; end;
  begin perform public.pulse_courier_handoff(tenant,o2,'redx',null,null,null); raise exception 'cross tenant handoff';
  exception when insufficient_privilege then null; end;
end $$;
select 'courier flow ok';
rollback;
