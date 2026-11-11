-- Phase 09: platform subscription plans (Pro / Enterprise, monthly or yearly, USD/GBP/BDT)
-- and monthly AI credits. Ported from dev/payment platform billing and adapted.
-- Platform billing is separate from merchants' customer orders.

create table public.billing_accounts (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  plan_key text check (plan_key in ('pro','enterprise')),
  pending_plan_key text check (pending_plan_key in ('pro','enterprise')),
  billing_interval text check (billing_interval in ('month','year')),
  currency_code text check (currency_code in ('USD','GBP','BDT')),
  provider text check (provider in ('stripe','sslcommerz')),
  state text not null default 'inactive' check (state in ('inactive','trialing','active','expired','review')),
  auto_renew boolean not null default false,
  trial_ends_at timestamptz,
  term_start timestamptz,
  paid_through timestamptz,
  stripe_customer_id text unique,
  stripe_subscription_id text unique,
  billing_name text,
  billing_email text,
  billing_phone text,
  billing_address text,
  updated_at timestamptz not null default now()
);
create table public.billing_checkouts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  plan_key text not null check (plan_key in ('pro','enterprise')),
  billing_interval text not null check (billing_interval in ('month','year')),
  provider text not null check (provider in ('stripe','sslcommerz')),
  kind text not null check (kind in ('purchase','upgrade')),
  auto_renew boolean not null default false,
  amount_minor bigint not null check (amount_minor >= 0),
  currency_code text not null check (currency_code in ('USD','GBP','BDT')),
  state text not null default 'pending' check (state in ('pending','completed','failed','review')),
  gateway_session_id text unique,
  gateway_url text,
  merchant_transaction_id text unique,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index billing_checkouts_tenant_idx on public.billing_checkouts(tenant_id,created_at desc);
create unique index billing_one_pending_checkout on public.billing_checkouts(tenant_id) where state='pending';
create table public.billing_invoices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  checkout_id uuid references public.billing_checkouts(id),
  plan_key text not null check (plan_key in ('pro','enterprise')),
  billing_interval text not null check (billing_interval in ('month','year')),
  kind text not null default 'purchase' check (kind in ('purchase','upgrade')),
  provider text not null check (provider in ('stripe','sslcommerz')),
  amount_minor bigint not null check (amount_minor > 0),
  currency_code text not null check (currency_code in ('USD','GBP','BDT')),
  state text not null default 'pending' check (state in ('pending','paid','failed','review')),
  provider_invoice_id text unique,
  provider_transaction_id text unique,
  period_start timestamptz,
  period_end timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now()
);
create index billing_invoices_tenant_idx on public.billing_invoices(tenant_id,created_at desc);
create table public.billing_webhook_events (
  provider text not null check (provider in ('stripe','sslcommerz')),
  event_id text not null,
  created_at timestamptz not null default now(),
  primary key(provider,event_id)
);
create table public.billing_operator_grants (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  access_until timestamptz not null,
  reason text not null,
  created_at timestamptz not null default now()
);

-- AI credits: 1 credit = 1 AI auto-reply. Balance resets to the allowance each monthly cycle (no rollover).
create table public.credit_accounts (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  allowance integer not null default 0 check (allowance >= 0),
  balance integer not null default 0 check (balance >= 0),
  cycle_start timestamptz not null default now(),
  cycle_end timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.credit_ledger (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  delta integer not null,
  reason text not null check (reason in ('trial','cycle_grant','upgrade_topup','ai_reply','refund')),
  source_id text not null,
  created_at timestamptz not null default now(),
  unique(reason,source_id)
);
create index credit_ledger_tenant_idx on public.credit_ledger(tenant_id,created_at desc);

alter table public.billing_accounts enable row level security;
alter table public.billing_checkouts enable row level security;
alter table public.billing_invoices enable row level security;
alter table public.billing_webhook_events enable row level security;
alter table public.billing_operator_grants enable row level security;
alter table public.credit_accounts enable row level security;
alter table public.credit_ledger enable row level security;
create policy billing_accounts_read on public.billing_accounts for select to authenticated
  using (public.pulse_is_member(tenant_id));
create policy billing_checkouts_read on public.billing_checkouts for select to authenticated
  using (public.pulse_is_member(tenant_id));
create policy billing_invoices_read on public.billing_invoices for select to authenticated
  using (public.pulse_is_member(tenant_id));
create policy credit_accounts_read on public.credit_accounts for select to authenticated
  using (public.pulse_is_member(tenant_id));
create policy credit_ledger_read on public.credit_ledger for select to authenticated
  using (public.pulse_is_member(tenant_id));
grant select on public.billing_accounts,public.billing_checkouts,public.billing_invoices,
  public.credit_accounts,public.credit_ledger to authenticated;
revoke all on public.billing_webhook_events,public.billing_operator_grants from anon,authenticated;

-- Stripe finalizes renewal invoices up to ~1 hour after the period ends; auto-renewing
-- Stripe subscriptions keep access for one day so a renewal never interrupts service.
create function public.pulse_billing_has_access(p_tenant_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.billing_operator_grants g
                where g.tenant_id=p_tenant_id and g.access_until>now())
    or exists(select 1 from public.billing_accounts a
               where a.tenant_id=p_tenant_id and
                 ((a.state='trialing' and a.trial_ends_at>now()) or
                  (a.state='active' and a.paid_through>now()) or
                  (a.state='active' and a.provider='stripe' and a.auto_renew
                   and a.paid_through+interval '1 day'>now())));
$$;
revoke all on function public.pulse_billing_has_access(uuid) from public,anon,authenticated;
grant execute on function public.pulse_billing_has_access(uuid) to service_role;

-- Every new workspace starts a 7-day, no-card trial with 200 AI credits.
create function public.pulse_billing_start_trial()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.billing_accounts(tenant_id,state,trial_ends_at)
    values(new.id,'trialing',now()+interval '7 days') on conflict do nothing;
  insert into public.credit_accounts(tenant_id,allowance,balance,cycle_start,cycle_end)
    values(new.id,200,200,now(),now()+interval '7 days') on conflict do nothing;
  insert into public.credit_ledger(tenant_id,delta,reason,source_id)
    values(new.id,200,'trial',new.id::text) on conflict do nothing;
  return new;
end;
$$;
create trigger billing_start_trial after insert on public.tenants
  for each row execute function public.pulse_billing_start_trial();

-- Existing development workspaces: temporary operator grant plus trial credits.
insert into public.billing_operator_grants(tenant_id,access_until,reason)
select id,now()+interval '30 days','Existing development workspace cutover' from public.tenants;
insert into public.billing_accounts(tenant_id,state) select id,'inactive' from public.tenants;
insert into public.credit_accounts(tenant_id,allowance,balance,cycle_start,cycle_end)
select id,200,200,now(),now()+interval '30 days' from public.tenants;
insert into public.credit_ledger(tenant_id,delta,reason,source_id)
select id,200,'trial',id::text from public.tenants;

-- Provider callbacks are settled with row locks so retries cannot extend a term or grant credits twice.
-- p_allowance is the monthly credit allowance of the checkout's plan (configured in the API).
create function public.pulse_billing_settle(p_checkout_id uuid,p_provider_invoice_id text,
  p_provider_transaction_id text,p_amount_minor bigint,p_currency_code text,
  p_period_start timestamptz,p_period_end timestamptz,p_allowance integer,p_risky boolean default false)
returns public.billing_invoices language plpgsql security definer set search_path = '' as $$
declare c public.billing_checkouts; a public.billing_accounts; ca public.credit_accounts;
  result public.billing_invoices; newer boolean; immediate boolean; fraction numeric; topup integer;
begin
  if current_setting('request.jwt.claim.role',true) <> 'service_role' then
    raise exception 'Service role required';
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
    -- Same term, higher plan: top up the remaining share of this credit cycle.
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

  -- A delayed older payment must never replace a newer plan or gateway.
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
    -- New or lapsed subscription: start a fresh credit cycle now. Early renewals keep the
    -- current cycle and are picked up by pulse_credit_roll_cycles at its end.
    update public.credit_accounts set allowance=p_allowance,balance=p_allowance,cycle_start=now(),
      cycle_end=least(now()+interval '1 month',p_period_end),updated_at=now()
    where tenant_id=c.tenant_id;
    insert into public.credit_ledger(tenant_id,delta,reason,source_id)
      values(c.tenant_id,p_allowance,'cycle_grant',c.id::text) on conflict do nothing;
  end if;
  return result;
end;
$$;
revoke all on function public.pulse_billing_settle(uuid,text,text,bigint,text,timestamptz,timestamptz,integer,boolean) from public,anon,authenticated;
grant execute on function public.pulse_billing_settle(uuid,text,text,bigint,text,timestamptz,timestamptz,integer,boolean) to service_role;

-- Charge one credit for one AI reply. Idempotent per source (agent job id).
create function public.pulse_credit_consume(p_tenant_id uuid,p_source_id text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if exists(select 1 from public.credit_ledger where reason='ai_reply' and source_id=p_source_id) then
    return true;
  end if;
  update public.credit_accounts set balance=balance-1,updated_at=now()
    where tenant_id=p_tenant_id and balance>0;
  if not found then return false; end if;
  insert into public.credit_ledger(tenant_id,delta,reason,source_id)
    values(p_tenant_id,-1,'ai_reply',p_source_id);
  return true;
exception when unique_violation then
  -- A concurrent call charged this source first; the block's decrement is rolled back.
  return true;
end;
$$;

-- Return the credit when the AI call failed after it was charged.
create function public.pulse_credit_refund(p_tenant_id uuid,p_source_id text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if not exists(select 1 from public.credit_ledger where reason='ai_reply' and source_id=p_source_id
                and tenant_id=p_tenant_id) then
    return false;
  end if;
  insert into public.credit_ledger(tenant_id,delta,reason,source_id)
    values(p_tenant_id,1,'refund',p_source_id) on conflict do nothing;
  if not found then return false; end if;
  update public.credit_accounts set balance=balance+1,updated_at=now() where tenant_id=p_tenant_id;
  return true;
end;
$$;

-- Monthly reset for paid workspaces (monthly and yearly terms alike). No rollover.
-- p_allowances maps plan_key to the monthly allowance, e.g. {"pro":4000,"enterprise":15000}.
create function public.pulse_credit_roll_cycles(p_allowances jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare r record; start_at timestamptz; end_at timestamptz; amount integer; rolled integer := 0;
begin
  for r in select ca.tenant_id,ca.cycle_end,a.paid_through,a.plan_key
           from public.credit_accounts ca join public.billing_accounts a using(tenant_id)
           where ca.cycle_end<=now() and a.state='active' and a.plan_key is not null
             and public.pulse_billing_has_access(ca.tenant_id)
           for update of ca skip locked loop
    start_at := case when r.cycle_end+interval '1 month'<now() then now() else r.cycle_end end;
    end_at := least(start_at+interval '1 month',r.paid_through);
    continue when end_at<=now();
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
revoke all on function public.pulse_credit_consume(uuid,text),public.pulse_credit_refund(uuid,text),
  public.pulse_credit_roll_cycles(jsonb) from public,anon,authenticated;
grant execute on function public.pulse_credit_consume(uuid,text),public.pulse_credit_refund(uuid,text),
  public.pulse_credit_roll_cycles(jsonb) to service_role;

-- User-scoped PostgREST RPCs also write to these tables. Enforce the same entitlement at the
-- database boundary so direct RPC calls cannot bypass API gating. Running out of credits
-- never triggers this guard; only an expired plan or trial does.
create function public.pulse_paid_write_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare tenant uuid;
begin
  if tg_table_name='messages' then
    if new.direction='inbound' then return new; end if;
  end if;
  tenant := coalesce(new.tenant_id,old.tenant_id);
  if not public.pulse_billing_has_access(tenant) then
    raise exception 'Subscription required' using errcode='P0001';
  end if;
  return new;
end;
$$;
do $$ declare name text; begin
  foreach name in array array['products','product_variants','commerce_orders',
    'commerce_payments','commerce_shipments','agent_configs','admin_proposals'] loop
    execute format('create trigger paid_write_guard before insert or update on public.%I '
      || 'for each row execute function public.pulse_paid_write_guard()',name);
  end loop;
end $$;
create trigger paid_outbound_guard before insert on public.messages
  for each row execute function public.pulse_paid_write_guard();
