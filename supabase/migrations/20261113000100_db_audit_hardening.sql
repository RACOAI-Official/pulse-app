-- Database audit hardening (2026-11-13).
-- 1. Least privilege: Supabase default ACLs had granted anon/authenticated full DML+TRUNCATE on
--    every public table and sequence. RLS blocked the API path, but TRUNCATE ignores RLS.
--    Reset to exactly what the app uses and stop future objects inheriting broad grants.
-- 2. pulse_billing_settle role guard read a legacy GUC PostgREST no longer sets (always NULL),
--    so the check never fired. Use auth.role(), which reads both forms.
-- 3. RLS: pulse_is_member(tenant_id) ran once per row. A set-returning helper runs once per
--    query (hashed subplan). Same isolation semantics.
-- 4. Missing indexes for FK columns and for tenant/time-range analytics scans.
-- 5. pulse_analytics: one grouped pass per table instead of five correlated scans per day.

-- 1. Privileges -------------------------------------------------------------------------------

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;

grant select on public.activity_events, public.admin_proposals, public.agent_configs,
  public.agent_versions, public.billing_accounts, public.billing_checkouts, public.billing_invoices,
  public.commerce_order_items, public.commerce_orders, public.commerce_payments,
  public.commerce_shipment_return_items, public.commerce_shipments, public.conversations,
  public.credit_accounts, public.credit_ledger, public.customer_profiles, public.delivery_settings,
  public.memberships, public.messages, public.platform_operators, public.product_variants,
  public.products, public.public_comments, public.stock_movements, public.support_tickets,
  public.tenants, public.usage_events
  to authenticated;
grant select, insert on public.agent_test_runs to authenticated;
grant update (state, unread_count) on public.conversations to authenticated;

-- RLS helpers (must stay executable for the querying role).
create function public.pulse_member_tenant_ids()
returns setof uuid language sql stable security definer set search_path = '' as $$
  select m.tenant_id from public.memberships m where m.user_id = (select auth.uid());
$$;
revoke execute on function public.pulse_member_tenant_ids() from public, anon;
grant execute on function public.pulse_is_member(uuid), public.pulse_is_owner(uuid),
  public.pulse_member_tenant_ids() to authenticated;

-- Uptime monitor.
grant execute on function public.pulse_heartbeat() to anon;

-- User-facing RPCs (unchanged set; previously granted per migration).
grant execute on function
  public.pulse_adjust_stock(uuid,integer,text),
  public.pulse_admin_allowed(uuid,boolean),
  public.pulse_admin_decide(uuid,uuid,boolean),
  public.pulse_admin_propose(uuid,text,text,jsonb),
  public.pulse_analytics(uuid,integer),
  public.pulse_archive_order(uuid,uuid,boolean),
  public.pulse_attach_order_to_conversation(uuid,uuid,uuid),
  public.pulse_courier_handoff(uuid,uuid,text,text,text,bigint),
  public.pulse_courier_return(uuid,uuid,jsonb,bigint,bigint,text),
  public.pulse_courier_returns_report(uuid,integer),
  public.pulse_courier_status(uuid,uuid,text),
  public.pulse_create_human_reply(uuid,text,uuid),
  public.pulse_create_ticket(uuid,uuid,text),
  public.pulse_import_products(uuid,jsonb),
  public.pulse_link_customer(uuid,uuid,uuid),
  public.pulse_mark_agent_tested(uuid,integer),
  public.pulse_ops_overview(),
  public.pulse_order_action(uuid,text,text),
  public.pulse_publish_agent(uuid),
  public.pulse_queue_comment_reply(uuid,uuid,text),
  public.pulse_record_payment(uuid,bigint,text,text),
  public.pulse_remove_product(uuid),
  public.pulse_restore_product(uuid),
  public.pulse_save_agent_draft(uuid,jsonb),
  public.pulse_save_order(uuid,uuid,text,text,text,text,integer,bigint,jsonb),
  public.pulse_save_product(uuid,uuid,text,text,text,text,jsonb,bigint,public.pulse_product_state,jsonb),
  public.pulse_search_conversations(uuid,text,public.pulse_channel,public.pulse_conversation_state),
  public.pulse_set_agent_enabled(uuid,boolean),
  public.pulse_set_currency(uuid,text),
  public.pulse_set_responder(uuid,text),
  public.pulse_set_ticket_status(uuid,uuid,text),
  public.pulse_team_performance(uuid,integer),
  public.pulse_unreplied_conversations(uuid),
  public.pulse_update_customer(uuid,uuid,text,text),
  public.pulse_usage_summary(uuid,integer)
  to authenticated;

-- Future objects created by migrations: no implicit access; every grant must be explicit.
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke execute on functions from anon, authenticated;
alter default privileges for role postgres revoke execute on functions from public;

-- 2. Billing settle guard --------------------------------------------------------------------

create or replace function public.pulse_billing_settle(p_checkout_id uuid,p_provider_invoice_id text,
  p_provider_transaction_id text,p_amount_minor bigint,p_currency_code text,
  p_period_start timestamptz,p_period_end timestamptz,p_allowance integer,p_risky boolean default false)
returns public.billing_invoices language plpgsql security definer set search_path = '' as $$
declare c public.billing_checkouts; a public.billing_accounts; ca public.credit_accounts;
  result public.billing_invoices; newer boolean; immediate boolean; fraction numeric; topup integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Service role required' using errcode='42501';
  end if;
  select * into c from public.billing_checkouts where id=p_checkout_id for update;
  if not found or c.amount_minor<>p_amount_minor or c.currency_code<>p_currency_code then
    raise exception 'Billing checkout mismatch';
  end if;
  if p_period_end<=p_period_start or p_period_start>now()+interval '1 year' or p_allowance<0 then
    raise exception 'Invalid billing period';
  end if;
  insert into public.billing_accounts(tenant_id) values(c.tenant_id) on conflict do nothing;
  select * into a from public.billing_accounts where tenant_id=c.tenant_id for update;
  select * into result from public.billing_invoices where checkout_id=c.id and state in ('paid','review') limit 1;
  if found then return result; end if;
  insert into public.billing_invoices(tenant_id,checkout_id,plan_key,billing_interval,kind,provider,
    amount_minor,currency_code,state,provider_invoice_id,provider_transaction_id,period_start,period_end,paid_at)
  values(c.tenant_id,c.id,c.plan_key,c.billing_interval,c.kind,c.provider,c.amount_minor,c.currency_code,
    case when p_risky then 'review' else 'paid' end,p_provider_invoice_id,p_provider_transaction_id,
    p_period_start,p_period_end,case when p_risky then null else now() end)
  returning * into result;
  update public.billing_checkouts set state=case when p_risky then 'review' else 'completed' end,
    completed_at=now() where id=c.id;
  if p_risky then return result; end if;

  insert into public.credit_accounts(tenant_id) values(c.tenant_id) on conflict do nothing;
  select * into ca from public.credit_accounts where tenant_id=c.tenant_id for update;

  if c.kind='upgrade' then
    update public.billing_accounts set plan_key=c.plan_key,pending_plan_key=null,updated_at=now()
      where tenant_id=c.tenant_id;
    fraction := case when ca.cycle_end<=ca.cycle_start or ca.cycle_end<=now() then 0
      else least(1,greatest(0,extract(epoch from ca.cycle_end-now())/extract(epoch from ca.cycle_end-ca.cycle_start))) end;
    topup := greatest(0,round((p_allowance-ca.allowance)*fraction))::integer;
    update public.credit_accounts set allowance=greatest(allowance,p_allowance),balance=balance+topup,
      updated_at=now() where tenant_id=c.tenant_id;
    insert into public.credit_ledger(tenant_id,delta,reason,source_id)
      values(c.tenant_id,topup,'upgrade_topup',c.id::text) on conflict do nothing;
    return result;
  end if;

  newer := a.paid_through is null or p_period_end>a.paid_through;
  immediate := a.paid_through is null or a.paid_through<=now() or a.state<>'active';
  update public.billing_accounts set
    plan_key=case when newer then c.plan_key else plan_key end,
    pending_plan_key=case when newer then null else pending_plan_key end,
    billing_interval=case when newer then c.billing_interval else billing_interval end,
    currency_code=case when newer then c.currency_code else currency_code end,
    provider=case when newer then c.provider else provider end,
    state=case when newer then 'active' else state end,
    auto_renew=case when newer then c.auto_renew else auto_renew end,
    term_start=case when newer then p_period_start else term_start end,
    paid_through=greatest(coalesce(paid_through,p_period_end),p_period_end),
    trial_ends_at=case when newer then null else trial_ends_at end,
    updated_at=now()
  where tenant_id=c.tenant_id;
  if newer and immediate then
    update public.credit_accounts set allowance=p_allowance,balance=p_allowance,cycle_start=now(),
      cycle_end=least(now()+interval '1 month',p_period_end),updated_at=now()
    where tenant_id=c.tenant_id;
    insert into public.credit_ledger(tenant_id,delta,reason,source_id)
      values(c.tenant_id,p_allowance,'cycle_grant',c.id::text) on conflict do nothing;
  end if;
  return result;
end;
$$;
revoke execute on function public.pulse_billing_settle(uuid,text,text,bigint,text,timestamptz,timestamptz,integer,boolean) from public,anon,authenticated;
grant execute on function public.pulse_billing_settle(uuid,text,text,bigint,text,timestamptz,timestamptz,integer,boolean) to service_role;

-- 3. RLS: evaluate membership once per query --------------------------------------------------

do $$
declare r record;
begin
  for r in select tablename, policyname from pg_policies
           where schemaname='public' and qual = 'pulse_is_member(tenant_id)' and cmd='SELECT'
           and tablename <> 'delivery_settings' loop
    execute format('alter policy %I on public.%I using (tenant_id in (select public.pulse_member_tenant_ids()))',
      r.policyname, r.tablename);
  end loop;
end $$;
alter policy delivery_settings_read on public.delivery_settings
  using (tenant_id in (select public.pulse_member_tenant_ids()));
alter policy conversations_update on public.conversations
  using (tenant_id in (select public.pulse_member_tenant_ids()))
  with check (tenant_id in (select public.pulse_member_tenant_ids()));
alter policy tenants_read on public.tenants
  using (id in (select public.pulse_member_tenant_ids()));
alter policy admin_proposals_read on public.admin_proposals
  using (actor_user_id = (select auth.uid()) and tenant_id in (select public.pulse_member_tenant_ids()));
alter policy agent_test_runs_read on public.agent_test_runs
  using (user_id = (select auth.uid()) and tenant_id in (select public.pulse_member_tenant_ids()));
alter policy agent_test_runs_insert on public.agent_test_runs
  with check (user_id = (select auth.uid()) and tenant_id in (select public.pulse_member_tenant_ids()));
alter policy operators_self_read on public.platform_operators
  using (user_id = (select auth.uid()));

-- 4. Indexes ----------------------------------------------------------------------------------

-- Tenant + time range scans (analytics, usage, team performance, ops).
create index messages_tenant_created_idx on public.messages (tenant_id, created_at);
create index commerce_orders_tenant_confirmed_idx on public.commerce_orders (tenant_id, confirmed_at)
  where confirmed_at is not null;
-- agent_jobs: hit on every inbound message (enqueue trigger) and responder/agent toggles.
create index agent_jobs_conversation_status_idx on public.agent_jobs (conversation_id, status);
create index agent_jobs_tenant_status_idx on public.agent_jobs (tenant_id, status);
create index agent_jobs_reply_message_idx on public.agent_jobs (reply_message_id)
  where reply_message_id is not null;
-- Remaining unindexed foreign keys (cascade / restrict checks on parent delete).
create index webhook_events_tenant_idx on public.webhook_events (tenant_id);
create index stock_movements_order_idx on public.stock_movements (order_id) where order_id is not null;
create index shipment_return_items_order_item_idx on public.commerce_shipment_return_items (order_item_id);
create index shipment_return_items_tenant_idx on public.commerce_shipment_return_items (tenant_id);
create index billing_invoices_checkout_idx on public.billing_invoices (checkout_id) where checkout_id is not null;
create index messages_sender_user_idx on public.messages (sender_user_id) where sender_user_id is not null;
create index stock_movements_actor_idx on public.stock_movements (actor_user_id) where actor_user_id is not null;
create index commerce_orders_created_by_idx on public.commerce_orders (created_by) where created_by is not null;
create index commerce_payments_actor_idx on public.commerce_payments (actor_user_id);
create index agent_test_runs_user_idx on public.agent_test_runs (user_id);
create index agent_versions_published_by_idx on public.agent_versions (published_by) where published_by is not null;
create index support_tickets_created_by_idx on public.support_tickets (created_by) where created_by is not null;
create index admin_proposals_actor_user_idx on public.admin_proposals (actor_user_id);

-- 5. pulse_analytics: same output, one grouped pass per table ----------------------------------

create or replace function public.pulse_analytics(p_tenant_id uuid, p_days integer default 7)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_today date;
  v_start timestamptz;
  v_result jsonb;
begin
  if not public.pulse_is_member(p_tenant_id) then
    raise exception 'Tenant not found' using errcode = '42501';
  end if;
  if p_days not in (7, 30, 90) then
    raise exception 'Unsupported period' using errcode = '22023';
  end if;
  v_today := (now() at time zone 'Asia/Dhaka')::date;
  v_start := (v_today - (p_days - 1))::timestamp at time zone 'Asia/Dhaka';

  with msg as (
    select (m.created_at at time zone 'Asia/Dhaka')::date as day,
      count(*) filter (where m.direction = 'inbound') as received,
      count(*) filter (where m.sender_type = 'ai' and m.delivery_state = 'sent') as ai_replies,
      count(*) filter (where m.sender_type = 'human' and m.delivery_state = 'sent') as human_replies
    from public.messages m
    where m.tenant_id = p_tenant_id and m.created_at >= v_start
    group by 1
  ),
  ord as (
    select (o.confirmed_at at time zone 'Asia/Dhaka')::date as day,
      count(*) as orders, sum(o.total_minor) as sales_minor
    from public.commerce_orders o
    where o.tenant_id = p_tenant_id and o.confirmed_at >= v_start and o.state <> 'cancelled'
    group by 1
  ),
  daily as (
    select g.day::date as day,
      coalesce(msg.received, 0) as received,
      coalesce(msg.ai_replies, 0) as ai_replies,
      coalesce(msg.human_replies, 0) as human_replies,
      coalesce(ord.orders, 0) as orders,
      coalesce(ord.sales_minor, 0) as sales_minor
    from generate_series(v_today - (p_days - 1), v_today, interval '1 day') g(day)
    left join msg on msg.day = g.day::date
    left join ord on ord.day = g.day::date
  ),
  totals as (
    select coalesce(sum(received), 0) as received, coalesce(sum(ai_replies), 0) as ai_replies,
      coalesce(sum(human_replies), 0) as human_replies, coalesce(sum(orders), 0) as orders,
      coalesce(sum(sales_minor), 0) as sales_minor from daily
  )
  select jsonb_build_object(
    'days', p_days, 'timezone', 'Asia/Dhaka',
    'currency', (select currency_code from public.tenants where id = p_tenant_id),
    'totals', (select jsonb_build_object('received', received, 'ai_replies', ai_replies,
      'human_replies', human_replies, 'orders', orders, 'sales_minor', sales_minor,
      'automation_percent', case when ai_replies + human_replies = 0 then 0
        else round(100.0 * ai_replies / (ai_replies + human_replies)) end) from totals),
    'today', (select to_jsonb(d) - 'day' from daily d order by day desc limit 1),
    'daily', coalesce((select jsonb_agg(to_jsonb(d) order by day) from daily d), '[]'::jsonb),
    'active_conversations', (select count(*) from public.conversations c where c.tenant_id = p_tenant_id
      and c.state = 'open' and c.last_message_at >= v_start),
    'pending_orders', (select count(*) from public.commerce_orders o where o.tenant_id = p_tenant_id
      and o.state in ('draft', 'pending_confirmation')),
    'channels', coalesce((select jsonb_agg(to_jsonb(x)) from (
      select channel, count(*) as received from public.messages
      where tenant_id = p_tenant_id and direction = 'inbound' and created_at >= v_start
      group by channel order by channel) x), '[]'::jsonb),
    'top_products', coalesce((select jsonb_agg(to_jsonb(x)) from (
      select i.product_title as title, sum(i.quantity) as units
      from public.commerce_order_items i join public.commerce_orders o on o.id = i.order_id
      where i.tenant_id = p_tenant_id and o.confirmed_at >= v_start and o.state <> 'cancelled'
      group by i.product_title order by units desc, title limit 5) x), '[]'::jsonb),
    'top_customers', coalesce((select jsonb_agg(to_jsonb(x)) from (
      select coalesce(nullif(o.customer_name, ''), 'Unnamed customer') as name,
        count(*) as orders, sum(o.total_minor) as sales_minor
      from public.commerce_orders o where o.tenant_id = p_tenant_id and o.confirmed_at >= v_start
        and o.state <> 'cancelled'
      group by coalesce(nullif(o.customer_name, ''), 'Unnamed customer'), o.customer_phone
      order by sales_minor desc, name limit 5) x), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;
