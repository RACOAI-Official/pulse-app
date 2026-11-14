-- Admin-managed plan prices and trial credits; owner alerts by email and WhatsApp.
-- Default privileges are revoked in this project: every table and function grants explicitly.

-- 1. Plan prices. Append-only versions; the newest row per (plan, interval, currency) is the
--    live price. With no row the API uses its configured default. Old Stripe price IDs stay
--    valid so grandfathered subscriptions keep renewing at the price they bought.
create table public.plan_price_versions (
  id bigint generated always as identity primary key,
  plan_key text not null check (plan_key in ('pro','enterprise')),
  billing_interval text not null check (billing_interval in ('month','year')),
  currency_code text not null check (currency_code in ('USD','GBP','BDT')),
  amount_minor integer not null check (amount_minor between 100 and 1000000000),
  stripe_price_id text check (stripe_price_id is null or stripe_price_id ~ '^price_[A-Za-z0-9]{1,100}$'),
  check ((currency_code = 'BDT') = (stripe_price_id is null)),
  actor_user_id uuid references auth.users(id) on delete set null,
  request_id uuid not null unique,
  created_at timestamptz not null default now()
);
create index plan_price_versions_key_idx
  on public.plan_price_versions (plan_key, billing_interval, currency_code, created_at desc);
create index plan_price_versions_actor_idx on public.plan_price_versions (actor_user_id) where actor_user_id is not null;
alter table public.plan_price_versions enable row level security;
revoke all on public.plan_price_versions from public, anon, authenticated;
grant select on public.plan_price_versions to service_role;

-- 2. Platform settings (single row).
create table public.platform_settings (
  id boolean primary key default true check (id),
  trial_credits integer not null default 200 check (trial_credits between 0 and 100000),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into public.platform_settings (id) values (true);
alter table public.platform_settings enable row level security;
revoke all on public.platform_settings from public, anon, authenticated;
grant select on public.platform_settings to service_role;

create or replace function public.pulse_billing_start_trial()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_credits integer := coalesce((select trial_credits from public.platform_settings where id), 200);
begin
  insert into public.billing_accounts(tenant_id,state,trial_ends_at)
    values(new.id,'trialing',now()+interval '7 days') on conflict do nothing;
  insert into public.credit_accounts(tenant_id,allowance,balance,cycle_start,cycle_end)
    values(new.id,v_credits,v_credits,now(),now()+interval '7 days') on conflict do nothing;
  if v_credits > 0 then
    insert into public.credit_ledger(tenant_id,delta,reason,source_id)
      values(new.id,v_credits,'trial',new.id::text) on conflict do nothing;
  end if;
  return new;
end;
$$;

-- 3. Audit actions for the new operator writes.
alter table public.admin_audit_log drop constraint admin_audit_log_action_check;
alter table public.admin_audit_log add constraint admin_audit_log_action_check
  check (action in ('credits_grant','credits_deduct','suspend','unsuspend','price_update','trial_credits_update'));

create function public.pulse_admin_set_price(p_plan text, p_interval text, p_currency text,
  p_amount integer, p_stripe_price_id text, p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := (select auth.uid()); v_previous integer;
begin
  perform public.pulse_require_operator();
  if p_plan not in ('pro','enterprise') or p_interval not in ('month','year')
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

create function public.pulse_admin_set_trial_credits(p_credits integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := (select auth.uid()); v_previous integer;
begin
  perform public.pulse_require_operator();
  if p_credits is null or p_credits < 0 or p_credits > 100000 then
    raise exception 'Trial credits must be between 0 and 100,000';
  end if;
  select trial_credits into v_previous from public.platform_settings where id for update;
  update public.platform_settings set trial_credits=p_credits,updated_by=v_actor,updated_at=now() where id;
  if v_previous is distinct from p_credits then
    insert into public.admin_audit_log(actor_user_id,action,tenant_id,details)
      values(v_actor,'trial_credits_update',null,jsonb_build_object('from',v_previous,'to',p_credits));
  end if;
  return jsonb_build_object('trial_credits',p_credits);
end;
$$;

create function public.pulse_admin_plans()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.pulse_require_operator();
  return jsonb_build_object(
    'trial_credits', (select trial_credits from public.platform_settings where id),
    'history', coalesce((select jsonb_agg(row_to_json(h) order by h.created_at desc) from (
      select v.plan_key, v.billing_interval, v.currency_code, v.amount_minor, v.stripe_price_id,
             v.created_at, u.email as actor_email
        from public.plan_price_versions v left join auth.users u on u.id=v.actor_user_id
       order by v.created_at desc, v.id desc limit 50) h), '[]'::jsonb));
end;
$$;

revoke all on function public.pulse_admin_set_price(text,text,text,integer,text,uuid),
  public.pulse_admin_set_trial_credits(integer), public.pulse_admin_plans() from public, anon;
grant execute on function public.pulse_admin_set_price(text,text,text,integer,text,uuid),
  public.pulse_admin_set_trial_credits(integer), public.pulse_admin_plans() to authenticated;

-- 4. Owner alerts. Events are deduplicated by key; each enabled, verified channel gets a durable
--    delivery row the worker sends (no network calls inside these transactions).
create table public.notification_settings (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  email text not null default '', whatsapp text not null default '',
  email_enabled boolean not null default false, whatsapp_enabled boolean not null default false,
  email_verified_at timestamptz, whatsapp_verified_at timestamptz, whatsapp_consent_at timestamptz,
  language text not null default 'bangla' check (language in ('bangla','english')),
  last_email_challenge timestamptz, last_whatsapp_challenge timestamptz, last_test_at timestamptz,
  check (not email_enabled or email_verified_at is not null),
  check (not whatsapp_enabled or (whatsapp_verified_at is not null and whatsapp_consent_at is not null))
);
create index notification_settings_whatsapp_idx on public.notification_settings (whatsapp) where whatsapp <> '';

create table public.notification_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  kind text not null check (kind in ('order_confirmed','order_drafted','credits_low','credits_empty',
                                     'plan_ending','plan_expired')),
  dedupe_key text not null unique check (char_length(dedupe_key) <= 200),
  summary jsonb not null,
  created_at timestamptz not null default now(),
  unique (id, tenant_id)
);
create index notification_events_tenant_idx on public.notification_events (tenant_id, created_at desc);

create table public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  event_id uuid,
  kind text not null check (kind in ('order_confirmed','order_drafted','credits_low','credits_empty',
                                     'plan_ending','plan_expired','test')),
  channel text not null check (channel in ('email','whatsapp')),
  destination text not null, language text not null check (language in ('bangla','english')),
  summary jsonb not null,
  status text not null default 'queued'
    check (status in ('queued','sending','accepted','sent','delivered','read','failed','uncertain','suppressed')),
  attempts integer not null default 0, next_attempt_at timestamptz not null default now(),
  claimed_at timestamptz, claim_token uuid, provider_id text, error text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (event_id, channel),
  foreign key (event_id, tenant_id) references public.notification_events(id, tenant_id) on delete cascade
);
create index notification_ready on public.notification_deliveries (next_attempt_at) where status = 'queued';
create index notification_sending on public.notification_deliveries (claimed_at) where status = 'sending';
create index notification_history on public.notification_deliveries (tenant_id, created_at desc);
create index notification_destination on public.notification_deliveries (destination) where status = 'queued';
create unique index notification_provider on public.notification_deliveries (provider_id)
  where channel = 'whatsapp' and provider_id is not null;

create table public.notification_challenges (
  token_hash text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  channel text not null check (channel in ('email','whatsapp')),
  destination text not null,
  expires_at timestamptz not null, consumed_at timestamptz
);
create index notification_challenges_tenant on public.notification_challenges (tenant_id, channel);
create index notification_challenges_expiry on public.notification_challenges (expires_at);

alter table public.notification_settings enable row level security;
alter table public.notification_events enable row level security;
alter table public.notification_deliveries enable row level security;
alter table public.notification_challenges enable row level security;
create policy notification_settings_read on public.notification_settings for select to authenticated
  using ((select public.pulse_is_owner(tenant_id)));
create policy notification_history_read on public.notification_deliveries for select to authenticated
  using ((select public.pulse_is_owner(tenant_id)));
revoke all on public.notification_settings, public.notification_events, public.notification_deliveries,
  public.notification_challenges from public, anon, authenticated;
grant select on public.notification_settings, public.notification_deliveries to authenticated;
grant select, insert, update, delete on public.notification_settings, public.notification_events,
  public.notification_deliveries, public.notification_challenges to service_role;

-- New owners get alerts at their sign-in email by default (already verified at sign-up).
create function public.pulse_default_notification_settings()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_email text;
begin
  if new.role <> 'owner' then return new; end if;
  select lower(email) into v_email from auth.users where id=new.user_id;
  if v_email is null or v_email = '' then return new; end if;
  insert into public.notification_settings(tenant_id,email,email_verified_at,email_enabled)
    values(new.tenant_id,v_email,now(),true) on conflict do nothing;
  return new;
end;
$$;
create trigger membership_default_notifications after insert on public.memberships
  for each row execute function public.pulse_default_notification_settings();

insert into public.notification_settings(tenant_id,email,email_verified_at,email_enabled)
select distinct on (m.tenant_id) m.tenant_id, lower(u.email), now(), true
  from public.memberships m join auth.users u on u.id=m.user_id
 where m.role='owner' and coalesce(u.email,'') <> ''
 order by m.tenant_id, m.created_at
on conflict do nothing;

-- Records one event and queues it for each enabled channel. Internal: callers are definer functions.
create function public.pulse_notify(p_tenant uuid, p_kind text, p_dedupe text, p_summary jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_event uuid; v_facts jsonb; s public.notification_settings;
begin
  v_facts := p_summary || jsonb_build_object('business',(select name from public.tenants where id=p_tenant));
  insert into public.notification_events(tenant_id,kind,dedupe_key,summary)
    values(p_tenant,p_kind,p_dedupe,v_facts) on conflict (dedupe_key) do nothing returning id into v_event;
  if v_event is null then return null; end if;
  select * into s from public.notification_settings where tenant_id=p_tenant;
  if s.email_enabled then
    insert into public.notification_deliveries(tenant_id,event_id,kind,channel,destination,language,summary)
      values(p_tenant,v_event,p_kind,'email',s.email,s.language,v_facts);
  end if;
  if s.whatsapp_enabled then
    insert into public.notification_deliveries(tenant_id,event_id,kind,channel,destination,language,summary)
      values(p_tenant,v_event,p_kind,'whatsapp',s.whatsapp,s.language,v_facts);
  end if;
  return v_event;
end;
$$;

create function public.pulse_order_summary(p_order uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('order_id',o.id,'customer',o.customer_name,
    'units',(select coalesce(sum(quantity),0) from public.commerce_order_items where order_id=o.id),
    'total_minor',o.total_minor,'currency',o.currency_code,
    'payment',case when p.paid>=o.total_minor and o.total_minor>0 then 'paid' when p.paid>0 then 'partial' else 'unpaid' end)
  from public.commerce_orders o
  cross join lateral (select coalesce(sum(amount_minor),0) paid from public.commerce_payments where order_id=o.id) p
  where o.id=p_order;
$$;

-- Deferred to commit so items, totals and payments written in the same transaction are counted.
create function public.pulse_order_confirmed_event()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists(select 1 from public.commerce_orders where id=new.id and state='confirmed') then
    perform public.pulse_notify(new.tenant_id,'order_confirmed','order_confirmed:'||new.id,
      public.pulse_order_summary(new.id));
  end if;
  return null;
end;
$$;
create constraint trigger order_confirmed_notification
  after insert or update of state on public.commerce_orders
  deferrable initially deferred for each row
  when (new.state = 'confirmed')
  execute function public.pulse_order_confirmed_event();

-- Called by the worker once the customer AI has drafted (and priced) an order.
create function public.pulse_notify_order_drafted(p_tenant uuid, p_order uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
begin
  if not exists(select 1 from public.commerce_orders where id=p_order and tenant_id=p_tenant
                and agent_job_id is not null) then
    return null;
  end if;
  return public.pulse_notify(p_tenant,'order_drafted','order_drafted:'||p_order,public.pulse_order_summary(p_order));
end;
$$;

-- Low (<=10% of the cycle allowance) and empty credit alerts, once per credit cycle each.
create function public.pulse_credit_alerts(p_tenant uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare ca public.credit_accounts; v_available integer;
begin
  select * into ca from public.credit_accounts where tenant_id=p_tenant;
  if not found or ca.allowance <= 0 then return; end if;
  v_available := ca.balance + ca.bonus_balance;
  if v_available * 10 > ca.allowance then return; end if;
  begin
    if v_available = 0 then
      perform public.pulse_notify(p_tenant,'credits_empty','credits_empty:'||p_tenant||':'||ca.cycle_start,
        jsonb_build_object('available',0,'allowance',ca.allowance));
    else
      perform public.pulse_notify(p_tenant,'credits_low','credits_low:'||p_tenant||':'||ca.cycle_start,
        jsonb_build_object('available',v_available,'allowance',ca.allowance));
    end if;
  exception when others then
    -- An alert must never block an AI reply.
    raise warning 'credit alert failed for %: %', p_tenant, sqlerrm;
  end;
end;
$$;

create or replace function public.pulse_credit_consume(p_tenant_id uuid, p_source_id text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_bucket text := 'plan';
begin
  if exists(select 1 from public.credit_ledger where reason='ai_reply' and source_id=p_source_id) then
    return true;
  end if;
  update public.credit_accounts set balance=balance-1,updated_at=now()
    where tenant_id=p_tenant_id and balance>0;
  if not found then
    update public.credit_accounts set bonus_balance=bonus_balance-1,updated_at=now()
      where tenant_id=p_tenant_id and bonus_balance>0;
    if not found then
      perform public.pulse_credit_alerts(p_tenant_id);
      return false;
    end if;
    v_bucket := 'bonus';
  end if;
  insert into public.credit_ledger(tenant_id,delta,reason,source_id,bucket)
    values(p_tenant_id,-1,'ai_reply',p_source_id,v_bucket);
  perform public.pulse_credit_alerts(p_tenant_id);
  return true;
exception when unique_violation then
  -- A concurrent call charged this source first; the block's decrement is rolled back.
  return true;
end;
$$;

-- Trial or paid term ending within 3 days, and recently ended without access. Run by the worker.
create function public.pulse_notify_billing_deadlines()
returns integer language plpgsql security definer set search_path = '' as $$
declare r record; v_count integer := 0; v_id uuid;
begin
  for r in
    select a.tenant_id, 'plan_ending' kind, 'trial' plan, a.trial_ends_at ends_at
      from public.billing_accounts a join public.tenants t on t.id=a.tenant_id
     where t.suspended_at is null and a.state='trialing'
       and a.trial_ends_at > now() and a.trial_ends_at <= now()+interval '3 days'
    union all
    select a.tenant_id, 'plan_expired', 'trial', a.trial_ends_at
      from public.billing_accounts a join public.tenants t on t.id=a.tenant_id
     where t.suspended_at is null and a.state='trialing'
       and a.trial_ends_at <= now() and a.trial_ends_at > now()-interval '3 days'
       and not public.pulse_billing_has_access(a.tenant_id)
    union all
    select a.tenant_id, 'plan_ending', a.plan_key, a.paid_through
      from public.billing_accounts a join public.tenants t on t.id=a.tenant_id
     where t.suspended_at is null and a.state='active' and a.plan_key is not null
       and not (a.provider='stripe' and a.auto_renew)
       and a.paid_through > now() and a.paid_through <= now()+interval '3 days'
    union all
    select a.tenant_id, 'plan_expired', a.plan_key, a.paid_through
      from public.billing_accounts a join public.tenants t on t.id=a.tenant_id
     where t.suspended_at is null and a.state in ('active','expired') and a.plan_key is not null
       and a.paid_through <= now() and a.paid_through > now()-interval '3 days'
       and not public.pulse_billing_has_access(a.tenant_id)
  loop
    v_id := public.pulse_notify(r.tenant_id, r.kind, r.kind||':'||r.tenant_id||':'||r.ends_at,
      jsonb_build_object('plan',r.plan,'ends_at',r.ends_at));
    if v_id is not null then v_count := v_count + 1; end if;
  end loop;
  return v_count;
end;
$$;

-- Owner settings, verification, test and retry (ported from the order-notification design).
create function public.pulse_save_notifications(p_tenant uuid,p_email text,p_whatsapp text,
  p_email_enabled boolean,p_whatsapp_enabled boolean,p_language text,p_consent boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare v public.notification_settings; v_login text; v_email text := lower(btrim(coalesce(p_email,'')));
  v_verified timestamptz;
begin
  if not public.pulse_is_owner(p_tenant) then raise exception 'Owner required' using errcode='42501'; end if;
  if char_length(v_email)>254 or v_email ~ E'[\\r\\n]' or (v_email<>'' and v_email !~ '^[^ @]+@[^ @]+\.[^ @]+$') or
     (p_whatsapp<>'' and p_whatsapp !~ '^\+[1-9][0-9]{7,14}$') or p_language not in ('bangla','english') then
    raise exception 'Invalid destination';
  end if;
  select lower(email) into v_login from auth.users where id=(select auth.uid());
  insert into public.notification_settings(tenant_id) values(p_tenant) on conflict do nothing;
  select * into v from public.notification_settings where tenant_id=p_tenant for update;
  -- The owner's own sign-in email was verified at sign-up.
  v_verified := case when v.email=v_email then v.email_verified_at
                     when v_email<>'' and v_email=v_login then now() end;
  update public.notification_settings set email=v_email,whatsapp=p_whatsapp,language=p_language,
    email_verified_at=v_verified,
    whatsapp_verified_at=case when v.whatsapp=p_whatsapp then v.whatsapp_verified_at end,
    whatsapp_consent_at=case when p_consent then coalesce(case when v.whatsapp=p_whatsapp then v.whatsapp_consent_at end,now()) end,
    email_enabled=p_email_enabled and v_verified is not null,
    whatsapp_enabled=p_whatsapp_enabled and p_consent and v.whatsapp=p_whatsapp and v.whatsapp_verified_at is not null
  where tenant_id=p_tenant;
  update public.notification_deliveries d set status='suppressed',updated_at=now()
    from public.notification_settings s where d.tenant_id=p_tenant and s.tenant_id=p_tenant and d.status='queued'
    and ((d.channel='email' and (not s.email_enabled or d.destination<>s.email)) or
         (d.channel='whatsapp' and (not s.whatsapp_enabled or d.destination<>s.whatsapp)));
  delete from public.notification_challenges where tenant_id=p_tenant and
    ((channel='email' and destination<>v_email) or (channel='whatsapp' and destination<>p_whatsapp));
end;
$$;

create function public.pulse_notification_challenge(p_tenant uuid,p_channel text,p_hash text)
returns text language plpgsql security definer set search_path = '' as $$
declare v public.notification_settings; v_destination text;
begin
  if not public.pulse_is_owner(p_tenant) then raise exception 'Owner required' using errcode='42501'; end if;
  select * into v from public.notification_settings where tenant_id=p_tenant for update;
  if not found or p_channel not in ('email','whatsapp') then raise exception 'Save settings first'; end if;
  if (p_channel='email' and v.last_email_challenge>now()-interval '1 minute') or
     (p_channel='whatsapp' and v.last_whatsapp_challenge>now()-interval '1 minute') then
    raise exception 'Wait one minute before retrying';
  end if;
  v_destination := case when p_channel='email' then v.email else v.whatsapp end;
  if v_destination='' or (p_channel='whatsapp' and v.whatsapp_consent_at is null) then
    raise exception 'Destination and consent required';
  end if;
  delete from public.notification_challenges where tenant_id=p_tenant and channel=p_channel;
  insert into public.notification_challenges values(p_hash,p_tenant,p_channel,v_destination,now()+interval '15 minutes',null);
  update public.notification_settings set
    last_email_challenge=case when p_channel='email' then now() else last_email_challenge end,
    last_whatsapp_challenge=case when p_channel='whatsapp' then now() else last_whatsapp_challenge end
  where tenant_id=p_tenant;
  return v_destination;
end;
$$;

create function public.pulse_verify_notification(p_hash text,p_channel text,p_sender text default '')
returns boolean language plpgsql security definer set search_path = '' as $$
declare v public.notification_challenges;
begin
  select * into v from public.notification_challenges where token_hash=p_hash and channel=p_channel
    and expires_at>now() and consumed_at is null for update;
  if not found or (p_channel='whatsapp' and v.destination<>p_sender) then return false; end if;
  update public.notification_settings set
    email_verified_at=case when p_channel='email' then now() else email_verified_at end,
    whatsapp_verified_at=case when p_channel='whatsapp' then now() else whatsapp_verified_at end
  where tenant_id=v.tenant_id and ((p_channel='email' and email=v.destination) or
        (p_channel='whatsapp' and whatsapp=v.destination and whatsapp_consent_at is not null));
  if not found then return false; end if;
  update public.notification_challenges set consumed_at=now() where token_hash=p_hash;
  return true;
end;
$$;

create function public.pulse_claim_notification(p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare d public.notification_deliveries; s public.notification_settings;
begin
  select * into d from public.notification_deliveries
    where id=p_id and status='queued' and next_attempt_at<=now() for update skip locked;
  if not found then return null; end if;
  select * into s from public.notification_settings where tenant_id=d.tenant_id;
  if not found or (d.channel='email' and (not s.email_enabled or s.email<>d.destination)) or
     (d.channel='whatsapp' and (not s.whatsapp_enabled or s.whatsapp<>d.destination or s.whatsapp_consent_at is null)) then
    update public.notification_deliveries set status='suppressed',updated_at=now() where id=p_id;
    return null;
  end if;
  update public.notification_deliveries set status='sending',attempts=attempts+1,claim_token=gen_random_uuid(),
    claimed_at=now(),updated_at=now() where id=p_id returning * into d;
  return to_jsonb(d);
end;
$$;

create function public.pulse_test_notification(p_tenant uuid,p_channel text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare s public.notification_settings; v_id uuid;
begin
  if not public.pulse_is_owner(p_tenant) then raise exception 'Owner required' using errcode='42501'; end if;
  select * into s from public.notification_settings where tenant_id=p_tenant for update;
  if not found or p_channel not in ('email','whatsapp') or (p_channel='email' and not s.email_enabled) or
     (p_channel='whatsapp' and not s.whatsapp_enabled) then
    raise exception 'Enable verified channel first';
  end if;
  if s.last_test_at>now()-interval '1 minute' then raise exception 'Wait one minute before retrying'; end if;
  insert into public.notification_deliveries(tenant_id,kind,channel,destination,language,summary)
    values(p_tenant,'test',p_channel,case when p_channel='email' then s.email else s.whatsapp end,s.language,
      jsonb_build_object('business',(select name from public.tenants where id=p_tenant)))
    returning id into v_id;
  update public.notification_settings set last_test_at=now() where tenant_id=p_tenant;
  return v_id;
end;
$$;

create function public.pulse_retry_notification(p_tenant uuid,p_id uuid,p_uncertain boolean default false)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if not public.pulse_is_owner(p_tenant) then raise exception 'Owner required' using errcode='42501'; end if;
  update public.notification_deliveries set status='queued',next_attempt_at=now(),attempts=0,error=null,
    provider_id=null,claim_token=null,updated_at=now()
  where id=p_id and tenant_id=p_tenant and (status='failed' or (status='uncertain' and p_uncertain));
  return found;
end;
$$;

revoke all on function public.pulse_save_notifications(uuid,text,text,boolean,boolean,text,boolean),
  public.pulse_notification_challenge(uuid,text,text), public.pulse_test_notification(uuid,text),
  public.pulse_retry_notification(uuid,uuid,boolean) from public, anon;
grant execute on function public.pulse_save_notifications(uuid,text,text,boolean,boolean,text,boolean),
  public.pulse_notification_challenge(uuid,text,text), public.pulse_test_notification(uuid,text),
  public.pulse_retry_notification(uuid,uuid,boolean) to authenticated;
revoke all on function public.pulse_verify_notification(text,text,text), public.pulse_claim_notification(uuid),
  public.pulse_notify_order_drafted(uuid,uuid), public.pulse_notify_billing_deadlines(),
  public.pulse_notify(uuid,text,text,jsonb), public.pulse_order_summary(uuid), public.pulse_credit_alerts(uuid),
  public.pulse_order_confirmed_event(), public.pulse_default_notification_settings()
  from public, anon, authenticated;
grant execute on function public.pulse_verify_notification(text,text,text), public.pulse_claim_notification(uuid),
  public.pulse_notify_order_drafted(uuid,uuid), public.pulse_notify_billing_deadlines() to service_role;
