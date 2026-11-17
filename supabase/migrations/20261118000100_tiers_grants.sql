-- Three plan tiers (Starter / Business / Enterprise) and operator-assigned plans.
-- The internal key 'pro' is kept and shown as "Business" so live subscriptions, invoices and
-- Stripe metadata keep working. Default privileges are revoked: every function grants explicitly.

-- 1. Plan keys.
alter table public.billing_accounts drop constraint billing_accounts_plan_key_check;
alter table public.billing_accounts add constraint billing_accounts_plan_key_check
  check (plan_key in ('starter','pro','enterprise'));
alter table public.billing_accounts drop constraint billing_accounts_pending_plan_key_check;
alter table public.billing_accounts add constraint billing_accounts_pending_plan_key_check
  check (pending_plan_key in ('starter','pro','enterprise'));
alter table public.billing_checkouts drop constraint billing_checkouts_plan_key_check;
alter table public.billing_checkouts add constraint billing_checkouts_plan_key_check
  check (plan_key in ('starter','pro','enterprise'));
alter table public.billing_invoices drop constraint billing_invoices_plan_key_check;
alter table public.billing_invoices add constraint billing_invoices_plan_key_check
  check (plan_key in ('starter','pro','enterprise'));
alter table public.plan_price_versions drop constraint plan_price_versions_plan_key_check;
alter table public.plan_price_versions add constraint plan_price_versions_plan_key_check
  check (plan_key in ('starter','pro','enterprise'));

create or replace function public.pulse_admin_set_price(p_plan text, p_interval text, p_currency text,
  p_amount integer, p_stripe_price_id text, p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := (select auth.uid()); v_previous integer;
begin
  perform public.pulse_require_operator();
  if p_plan not in ('starter','pro','enterprise') or p_interval not in ('month','year')
     or p_currency not in ('USD','GBP','BDT') then
    raise exception 'Unknown plan, interval or currency';
  end if;
  if p_amount is null or p_amount < 100 or p_amount > 1000000000 then
    raise exception 'Price must be between 1.00 and 10,000,000.00';
  end if;
  if exists(select 1 from public.plan_price_versions where request_id=p_request_id) then
    return jsonb_build_object('replayed',true);
  end if;
  select amount_minor into v_previous from public.plan_price_versions
    where plan_key=p_plan and billing_interval=p_interval and currency_code=p_currency
    order by created_at desc, id desc limit 1;
  insert into public.plan_price_versions(plan_key,billing_interval,currency_code,amount_minor,
      stripe_price_id,actor_user_id,request_id)
    values(p_plan,p_interval,p_currency,p_amount,nullif(p_stripe_price_id,''),v_actor,p_request_id);
  insert into public.admin_audit_log(actor_user_id,action,tenant_id,details)
    values(v_actor,'price_update',null,jsonb_build_object('plan',p_plan,'interval',p_interval,
      'currency',p_currency,'amount_minor',p_amount,'previous_minor',v_previous,
      'stripe_price_id',nullif(p_stripe_price_id,'')));
  return jsonb_build_object('replayed',false);
exception when unique_violation then
  return jsonb_build_object('replayed',true);
end;
$$;

-- New BDT list prices go live even where an older admin override exists.
insert into public.plan_price_versions(plan_key,billing_interval,currency_code,amount_minor,request_id)
values ('starter','month','BDT',499900,gen_random_uuid()),('starter','year','BDT',4999000,gen_random_uuid()),
       ('pro','month','BDT',649900,gen_random_uuid()),('pro','year','BDT',6499000,gen_random_uuid()),
       ('enterprise','month','BDT',1099900,gen_random_uuid()),('enterprise','year','BDT',10999000,gen_random_uuid());

-- 2. Operator-assigned plans. A grant with plan_key null is a legacy access-only grant.
alter table public.billing_operator_grants
  add column plan_key text check (plan_key in ('starter','pro','enterprise')),
  add column months integer check (months between 1 and 24),
  add column granted_by uuid references auth.users(id) on delete set null;
create index billing_operator_grants_granted_by_idx on public.billing_operator_grants (granted_by)
  where granted_by is not null;

alter table public.admin_audit_log drop constraint admin_audit_log_action_check;
alter table public.admin_audit_log add constraint admin_audit_log_action_check
  check (action in ('credits_grant','credits_deduct','suspend','unsuspend','price_update',
                    'trial_credits_update','plan_assign','plan_revoke'));

alter table public.credit_ledger drop constraint credit_ledger_reason_check;
alter table public.credit_ledger add constraint credit_ledger_reason_check check (reason in
  ('trial','cycle_grant','upgrade_topup','ai_reply','refund','admin_grant','admin_deduct','admin_plan'));

create function public.pulse_plan_rank(p_plan text)
returns integer language sql immutable set search_path = '' as $$
  select case p_plan when 'starter' then 1 when 'pro' then 2 when 'enterprise' then 3 else 0 end;
$$;

-- Highest plan the tenant holds right now: an operator grant or a paid term. Null on trial,
-- with no plan, or while suspended.
create function public.pulse_billing_effective_plan(p_tenant_id uuid)
returns text language sql stable security definer set search_path = '' as $$
  select p.plan_key from (
    select g.plan_key from public.billing_operator_grants g
      where g.tenant_id=p_tenant_id and g.plan_key is not null and g.access_until>now()
    union all
    select a.plan_key from public.billing_accounts a
      where a.tenant_id=p_tenant_id and a.state='active' and a.plan_key is not null
        and (a.paid_through>now() or (a.provider='stripe' and a.auto_renew
             and a.paid_through+interval '1 day'>now()))
  ) p
  where not exists(select 1 from public.tenants t where t.id=p_tenant_id and t.suspended_at is not null)
  order by public.pulse_plan_rank(p.plan_key) desc limit 1;
$$;

-- Monthly credit cycles follow the effective plan, so operator-assigned plans renew credits too.
create or replace function public.pulse_credit_roll_cycles(p_allowances jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare r record; start_at timestamptz; end_at timestamptz; amount integer; rolled integer := 0;
begin
  for r in select ca.tenant_id, ca.cycle_end, p.plan_key,
                  greatest(a.paid_through, g.access_until) as until_at
           from public.credit_accounts ca
           cross join lateral (select public.pulse_billing_effective_plan(ca.tenant_id) as plan_key) p
           left join public.billing_accounts a on a.tenant_id=ca.tenant_id and a.state='active'
           left join public.billing_operator_grants g on g.tenant_id=ca.tenant_id
             and g.plan_key is not null and g.access_until>now()
           where ca.cycle_end<=now() and p.plan_key is not null
           for update of ca skip locked loop
    start_at := case when r.cycle_end+interval '1 month'<now() then now() else r.cycle_end end;
    end_at := least(start_at+interval '1 month',r.until_at);
    continue when end_at is null or end_at<=now();
    amount := coalesce((p_allowances->>r.plan_key)::integer,0);
    update public.credit_accounts set allowance=amount,balance=amount,cycle_start=start_at,
      cycle_end=end_at,updated_at=now() where tenant_id=r.tenant_id;
    insert into public.credit_ledger(tenant_id,delta,reason,source_id)
      values(r.tenant_id,amount,'cycle_grant',r.tenant_id::text||':'||start_at::text) on conflict do nothing;
    rolled := rolled+1;
  end loop;
  return rolled;
end;
$$;

create function public.pulse_admin_assign_plan(p_tenant_id uuid, p_plan text, p_months integer,
  p_reason text, p_allowance integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := (select auth.uid()); v_reason text := btrim(coalesce(p_reason,''));
  v_until timestamptz;
begin
  perform public.pulse_require_operator();
  if p_plan not in ('starter','pro','enterprise') then
    raise exception 'Unknown plan';
  end if;
  if p_months is null or p_months < 1 or p_months > 24 then
    raise exception 'Months must be between 1 and 24';
  end if;
  if char_length(v_reason) < 3 or char_length(v_reason) > 500 then
    raise exception 'A reason of 3 to 500 characters is required';
  end if;
  if p_allowance is null or p_allowance < 0 or p_allowance > 1000000 then
    raise exception 'Invalid credit allowance';
  end if;
  if not exists(select 1 from public.tenants where id=p_tenant_id) then
    raise exception 'Business not found' using errcode='P0002';
  end if;
  v_until := now() + make_interval(months => p_months);
  insert into public.billing_operator_grants(tenant_id,access_until,reason,plan_key,months,granted_by)
    values(p_tenant_id,v_until,v_reason,p_plan,p_months,v_actor)
  on conflict (tenant_id) do update set access_until=excluded.access_until,reason=excluded.reason,
    plan_key=excluded.plan_key,months=excluded.months,granted_by=excluded.granted_by,created_at=now();
  insert into public.credit_accounts(tenant_id) values(p_tenant_id) on conflict do nothing;
  update public.credit_accounts set allowance=p_allowance,balance=p_allowance,cycle_start=now(),
    cycle_end=least(now()+interval '1 month',v_until),updated_at=now() where tenant_id=p_tenant_id;
  insert into public.credit_ledger(tenant_id,delta,reason,source_id,actor_user_id,note)
    values(p_tenant_id,p_allowance,'admin_plan',gen_random_uuid()::text,v_actor,v_reason);
  insert into public.admin_audit_log(actor_user_id,action,tenant_id,details)
    values(v_actor,'plan_assign',p_tenant_id,jsonb_build_object('plan',p_plan,'months',p_months,
      'access_until',v_until,'reason',v_reason));
  return jsonb_build_object('plan_key',p_plan,'access_until',v_until);
end;
$$;

create function public.pulse_admin_revoke_plan(p_tenant_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := (select auth.uid()); v_reason text := btrim(coalesce(p_reason,''));
  v_plan text; v_balance integer;
begin
  perform public.pulse_require_operator();
  if char_length(v_reason) < 3 or char_length(v_reason) > 500 then
    raise exception 'A reason of 3 to 500 characters is required';
  end if;
  delete from public.billing_operator_grants where tenant_id=p_tenant_id and plan_key is not null
    returning plan_key into v_plan;
  if not found then
    raise exception 'This business has no assigned plan' using errcode='P0002';
  end if;
  -- A real paid subscription keeps its credits; otherwise the plan bucket empties (bonus stays).
  if public.pulse_billing_effective_plan(p_tenant_id) is null then
    select balance into v_balance from public.credit_accounts where tenant_id=p_tenant_id for update;
    update public.credit_accounts set allowance=0,balance=0,cycle_end=now(),updated_at=now()
      where tenant_id=p_tenant_id;
    if coalesce(v_balance,0) > 0 then
      insert into public.credit_ledger(tenant_id,delta,reason,source_id,actor_user_id,note)
        values(p_tenant_id,-v_balance,'admin_plan',gen_random_uuid()::text,v_actor,v_reason);
    end if;
  end if;
  insert into public.admin_audit_log(actor_user_id,action,tenant_id,details)
    values(v_actor,'plan_revoke',p_tenant_id,jsonb_build_object('plan',v_plan,'reason',v_reason));
  return jsonb_build_object('revoked',v_plan,'effective_plan',public.pulse_billing_effective_plan(p_tenant_id));
end;
$$;

-- Business list shows operator-assigned plans; "paid" includes them.
create or replace function public.pulse_admin_businesses(p_q text default '', p_status text default 'all',
  p_limit integer default 50, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_q text := lower(btrim(coalesce(p_q,''))); v_result jsonb;
begin
  perform public.pulse_require_operator();
  if p_status not in ('all','paid','trialing','expired','suspended') then
    raise exception 'Invalid status filter';
  end if;
  with base as (
    select t.id,t.name,t.created_at,t.suspended_at,t.suspended_reason,
      (select u.email from public.memberships m join auth.users u on u.id=m.user_id
        where m.tenant_id=t.id and m.role='owner' order by m.created_at limit 1) as owner_email,
      a.plan_key,a.state as billing_state,a.provider,a.paid_through,a.trial_ends_at,
      c.balance,c.allowance,coalesce(c.bonus_balance,0) as bonus_balance,
      (select count(*) from public.memberships m where m.tenant_id=t.id) as members,
      public.pulse_billing_has_access(t.id) as access,
      g.plan_key as grant_plan_key,g.access_until as grant_until
    from public.tenants t
    left join public.billing_accounts a on a.tenant_id=t.id
    left join public.billing_operator_grants g on g.tenant_id=t.id and g.plan_key is not null
      and g.access_until>now()
    left join public.credit_accounts c on c.tenant_id=t.id
  ), filtered as (
    select * from base b
    where (v_q='' or position(v_q in lower(b.name))>0 or position(v_q in lower(coalesce(b.owner_email,'')))>0
           or b.id::text=v_q)
      and case p_status
        when 'paid' then ((b.billing_state='active' and b.paid_through>now()) or b.grant_plan_key is not null)
          and b.suspended_at is null
        when 'trialing' then b.billing_state='trialing' and b.trial_ends_at>now() and b.suspended_at is null
        when 'expired' then not b.access and b.suspended_at is null
        when 'suspended' then b.suspended_at is not null
        else true end
  )
  select jsonb_build_object(
    'total', (select count(*) from filtered),
    'rows', coalesce((select jsonb_agg(to_jsonb(f) order by f.created_at desc) from (
      select * from filtered order by created_at desc
      limit least(greatest(p_limit,1),100) offset greatest(p_offset,0)) f), '[]'::jsonb))
  into v_result;
  return v_result;
end;
$$;

-- 3. Starter catalog cap: at most 50 non-archived products. Existing rows are never removed.
create function public.pulse_catalog_limit_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.state = 'archived' then return new; end if;
  if tg_op = 'UPDATE' and old.state <> 'archived' then return new; end if;
  if public.pulse_billing_effective_plan(new.tenant_id) = 'starter'
     and (select count(*) from public.products p
          where p.tenant_id=new.tenant_id and p.state <> 'archived' and p.id <> new.id) >= 50 then
    raise exception 'Starter plan allows 50 products. Upgrade to add more' using errcode='P0001';
  end if;
  return new;
end;
$$;
create trigger catalog_limit_guard before insert or update of state on public.products
  for each row execute function public.pulse_catalog_limit_guard();

revoke all on function public.pulse_plan_rank(text), public.pulse_billing_effective_plan(uuid),
  public.pulse_credit_roll_cycles(jsonb), public.pulse_admin_assign_plan(uuid,text,integer,text,integer),
  public.pulse_admin_revoke_plan(uuid,text), public.pulse_catalog_limit_guard(),
  public.pulse_admin_set_price(text,text,text,integer,text,uuid)
from public, anon, authenticated;
grant execute on function public.pulse_plan_rank(text) to authenticated, service_role;
grant execute on function public.pulse_billing_effective_plan(uuid), public.pulse_credit_roll_cycles(jsonb)
  to service_role;
grant execute on function public.pulse_admin_assign_plan(uuid,text,integer,text,integer),
  public.pulse_admin_revoke_plan(uuid,text), public.pulse_admin_set_price(text,text,text,integer,text,uuid)
  to authenticated;
