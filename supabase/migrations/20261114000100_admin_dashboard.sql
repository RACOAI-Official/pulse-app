-- Admin dashboard: bonus credits, workspace suspension, append-only admin audit log,
-- and operator-only RPCs. Every admin RPC re-checks platform_operators and takes the
-- actor from auth.uid(); default privileges are revoked, so grants below are explicit.

-- 1. Bonus credits: a bucket the monthly reset never touches.
alter table public.credit_accounts
  add column bonus_balance integer not null default 0 check (bonus_balance >= 0);

alter table public.credit_ledger drop constraint credit_ledger_reason_check;
alter table public.credit_ledger
  add constraint credit_ledger_reason_check check (reason in
    ('trial','cycle_grant','upgrade_topup','ai_reply','refund','admin_grant','admin_deduct')),
  add column bucket text not null default 'plan' check (bucket in ('plan','bonus')),
  add column actor_user_id uuid references auth.users(id) on delete set null,
  add column note text check (note is null or char_length(note) <= 500);
create index credit_ledger_created_idx on public.credit_ledger (created_at desc);
create index credit_ledger_actor_idx on public.credit_ledger (actor_user_id) where actor_user_id is not null;

-- 2. Suspension: read-only workspace, AI and outbound sends stop (via pulse_billing_has_access).
alter table public.tenants
  add column suspended_at timestamptz,
  add column suspended_reason text check (suspended_reason is null or char_length(suspended_reason) <= 500);

-- 3. Append-only audit of operator actions. No grants: written and read only through definer RPCs.
create table public.admin_audit_log (
  id bigint generated always as identity primary key,
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null check (action in ('credits_grant','credits_deduct','suspend','unsuspend')),
  tenant_id uuid references public.tenants(id) on delete set null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.admin_audit_log enable row level security;
revoke all on public.admin_audit_log from public, anon, authenticated;
create index admin_audit_log_created_idx on public.admin_audit_log (created_at desc);
create index admin_audit_log_tenant_idx on public.admin_audit_log (tenant_id, created_at desc);
create index admin_audit_log_actor_idx on public.admin_audit_log (actor_user_id) where actor_user_id is not null;

create index billing_invoices_created_idx on public.billing_invoices (created_at desc);

-- 4. Credit spend order: plan credits first, then bonus. Refunds return to the bucket that paid.
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
    if not found then return false; end if;
    v_bucket := 'bonus';
  end if;
  insert into public.credit_ledger(tenant_id,delta,reason,source_id,bucket)
    values(p_tenant_id,-1,'ai_reply',p_source_id,v_bucket);
  return true;
exception when unique_violation then
  -- A concurrent call charged this source first; the block's decrement is rolled back.
  return true;
end;
$$;

create or replace function public.pulse_credit_refund(p_tenant_id uuid, p_source_id text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_bucket text;
begin
  select bucket into v_bucket from public.credit_ledger
    where reason='ai_reply' and source_id=p_source_id and tenant_id=p_tenant_id;
  if not found then return false; end if;
  insert into public.credit_ledger(tenant_id,delta,reason,source_id,bucket)
    values(p_tenant_id,1,'refund',p_source_id,v_bucket) on conflict do nothing;
  if not found then return false; end if;
  if v_bucket = 'bonus' then
    update public.credit_accounts set bonus_balance=bonus_balance+1,updated_at=now() where tenant_id=p_tenant_id;
  else
    update public.credit_accounts set balance=balance+1,updated_at=now() where tenant_id=p_tenant_id;
  end if;
  return true;
end;
$$;

-- Suspended workspaces have no access: worker AI replies and outbound sends stop.
create or replace function public.pulse_billing_has_access(p_tenant_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select not exists(select 1 from public.tenants t where t.id=p_tenant_id and t.suspended_at is not null)
    and (exists(select 1 from public.billing_operator_grants g
                where g.tenant_id=p_tenant_id and g.access_until>now())
      or exists(select 1 from public.billing_accounts a
                 where a.tenant_id=p_tenant_id and
                   ((a.state='trialing' and a.trial_ends_at>now()) or
                    (a.state='active' and a.paid_through>now()) or
                    (a.state='active' and a.provider='stripe' and a.auto_renew
                     and a.paid_through+interval '1 day'>now()))));
$$;

-- 5. Operator RPCs.
create function public.pulse_require_operator()
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists(select 1 from public.platform_operators where user_id=(select auth.uid())) then
    raise exception 'Operator access required' using errcode='42501';
  end if;
end;
$$;

create function public.pulse_admin_overview()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.pulse_require_operator();
  return jsonb_build_object(
    'businesses', (select count(*) from public.tenants),
    'paid', (select count(*) from public.billing_accounts where state='active' and paid_through>now()),
    'trialing', (select count(*) from public.billing_accounts where state='trialing' and trial_ends_at>now()),
    'suspended', (select count(*) from public.tenants where suspended_at is not null),
    'users', (select count(*) from auth.users),
    'signups_7d', (select count(*) from public.tenants where created_at>now()-interval '7 days'),
    'payments_review', (select count(*) from public.billing_invoices where state='review'),
    'revenue_30d', coalesce((select jsonb_object_agg(currency_code,total) from (
        select currency_code,sum(amount_minor) as total from public.billing_invoices
        where state='paid' and paid_at>now()-interval '30 days' group by currency_code) r), '{}'::jsonb),
    'connected_channels', (select count(*) from public.channel_connections where status='connected'),
    'failed_webhooks', (select count(*) from public.webhook_events where status='failed'),
    'problem_sends', (select count(*) from public.messages where delivery_state in ('failed','uncertain'))
  );
end;
$$;

create function public.pulse_admin_businesses(p_q text default '', p_status text default 'all',
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
      public.pulse_billing_has_access(t.id) as access
    from public.tenants t
    left join public.billing_accounts a on a.tenant_id=t.id
    left join public.credit_accounts c on c.tenant_id=t.id
  ), filtered as (
    select * from base b
    where (v_q='' or position(v_q in lower(b.name))>0 or position(v_q in lower(coalesce(b.owner_email,'')))>0
           or b.id::text=v_q)
      and case p_status
        when 'paid' then b.billing_state='active' and b.paid_through>now() and b.suspended_at is null
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

create function public.pulse_admin_business(p_tenant_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_tenant jsonb;
begin
  perform public.pulse_require_operator();
  select to_jsonb(t) - 'onboarding_step' into v_tenant from public.tenants t where t.id=p_tenant_id;
  if v_tenant is null then
    raise exception 'Business not found' using errcode='P0002';
  end if;
  return jsonb_build_object(
    'tenant', v_tenant,
    'access', public.pulse_billing_has_access(p_tenant_id),
    'billing', (select to_jsonb(a) - 'stripe_customer_id' - 'stripe_subscription_id'
                from public.billing_accounts a where a.tenant_id=p_tenant_id),
    'operator_grant', (select to_jsonb(g) from public.billing_operator_grants g where g.tenant_id=p_tenant_id),
    'credits', (select to_jsonb(c) from public.credit_accounts c where c.tenant_id=p_tenant_id),
    'ai_replies_30d', (select count(*) from public.credit_ledger
                       where tenant_id=p_tenant_id and reason='ai_reply' and created_at>now()-interval '30 days'),
    'members', coalesce((select jsonb_agg(jsonb_build_object('user_id',m.user_id,'email',u.email,'role',m.role,
        'joined_at',m.created_at,'last_sign_in_at',u.last_sign_in_at) order by m.created_at)
      from public.memberships m join auth.users u on u.id=m.user_id where m.tenant_id=p_tenant_id), '[]'::jsonb),
    'counts', jsonb_build_object(
      'channels', (select count(*) from public.channel_connections where tenant_id=p_tenant_id and status='connected'),
      'conversations', (select count(*) from public.conversations where tenant_id=p_tenant_id),
      'orders', (select count(*) from public.commerce_orders where tenant_id=p_tenant_id),
      'products', (select count(*) from public.products where tenant_id=p_tenant_id)),
    'invoices', coalesce((select jsonb_agg(to_jsonb(i) order by i.created_at desc) from (
      select id,plan_key,billing_interval,kind,provider,amount_minor,currency_code,state,
        provider_transaction_id,period_start,period_end,paid_at,created_at
      from public.billing_invoices where tenant_id=p_tenant_id order by created_at desc limit 50) i), '[]'::jsonb),
    'ledger', coalesce((select jsonb_agg(to_jsonb(l) order by l.created_at desc) from (
      select cl.id,cl.delta,cl.reason,cl.bucket,cl.note,cl.created_at,u.email as actor_email
      from public.credit_ledger cl left join auth.users u on u.id=cl.actor_user_id
      where cl.tenant_id=p_tenant_id and cl.reason not in ('ai_reply','refund')
      order by cl.created_at desc limit 100) l), '[]'::jsonb)
  );
end;
$$;

create function public.pulse_admin_users(p_q text default '', p_limit integer default 50, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_q text := lower(btrim(coalesce(p_q,''))); v_result jsonb;
begin
  perform public.pulse_require_operator();
  with filtered as (
    select u.id,u.email,u.created_at,u.last_sign_in_at,u.email_confirmed_at,
      exists(select 1 from public.platform_operators o where o.user_id=u.id) as is_operator,
      coalesce((select jsonb_agg(jsonb_build_object('tenant_id',m.tenant_id,'name',t.name,'role',m.role)
        order by t.name) from public.memberships m join public.tenants t on t.id=m.tenant_id
        where m.user_id=u.id), '[]'::jsonb) as workspaces
    from auth.users u
    where v_q='' or position(v_q in lower(coalesce(u.email,'')))>0 or u.id::text=v_q
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

create function public.pulse_admin_payments(p_provider text default null, p_state text default null,
  p_limit integer default 50, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_result jsonb;
begin
  perform public.pulse_require_operator();
  with filtered as (
    select i.id,i.tenant_id,t.name as tenant_name,i.plan_key,i.billing_interval,i.kind,i.provider,
      i.amount_minor,i.currency_code,i.state,i.provider_invoice_id,i.provider_transaction_id,
      i.period_start,i.period_end,i.paid_at,i.created_at
    from public.billing_invoices i left join public.tenants t on t.id=i.tenant_id
    where (p_provider is null or i.provider=p_provider) and (p_state is null or i.state=p_state)
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

create function public.pulse_admin_credits(p_reason text default null, p_tenant_id uuid default null,
  p_limit integer default 50, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_result jsonb;
begin
  perform public.pulse_require_operator();
  with filtered as (
    select cl.id,cl.tenant_id,t.name as tenant_name,cl.delta,cl.reason,cl.bucket,cl.note,cl.source_id,
      cl.created_at,u.email as actor_email
    from public.credit_ledger cl
    left join public.tenants t on t.id=cl.tenant_id
    left join auth.users u on u.id=cl.actor_user_id
    where (p_reason is null or cl.reason=p_reason) and (p_tenant_id is null or cl.tenant_id=p_tenant_id)
  )
  select jsonb_build_object(
    'total', (select count(*) from filtered),
    'rows', coalesce((select jsonb_agg(to_jsonb(f) order by f.created_at desc, f.id desc) from (
      select * from filtered order by created_at desc, id desc
      limit least(greatest(p_limit,1),100) offset greatest(p_offset,0)) f), '[]'::jsonb))
  into v_result;
  return v_result;
end;
$$;

create function public.pulse_admin_audit(p_limit integer default 50, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.pulse_require_operator();
  return jsonb_build_object(
    'total', (select count(*) from public.admin_audit_log),
    'rows', coalesce((select jsonb_agg(to_jsonb(f) order by f.id desc) from (
      select l.id,l.action,l.tenant_id,t.name as tenant_name,l.details,l.created_at,u.email as actor_email
      from public.admin_audit_log l
      left join public.tenants t on t.id=l.tenant_id
      left join auth.users u on u.id=l.actor_user_id
      order by l.id desc limit least(greatest(p_limit,1),100) offset greatest(p_offset,0)) f), '[]'::jsonb));
end;
$$;

create function public.pulse_admin_adjust_credits(p_tenant_id uuid, p_amount integer, p_note text,
  p_idempotency_key uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := (select auth.uid()); v_note text := btrim(coalesce(p_note,'')); v_balance integer;
begin
  perform public.pulse_require_operator();
  if p_amount is null or p_amount = 0 or abs(p_amount) > 1000000 then
    raise exception 'Amount must be non-zero and at most 1,000,000';
  end if;
  if char_length(v_note) < 3 or char_length(v_note) > 500 then
    raise exception 'A reason of 3 to 500 characters is required';
  end if;
  if not exists(select 1 from public.tenants where id=p_tenant_id) then
    raise exception 'Business not found' using errcode='P0002';
  end if;
  -- Replays of the same request key return the current balance instead of applying twice.
  if exists(select 1 from public.credit_ledger where tenant_id=p_tenant_id
            and reason in ('admin_grant','admin_deduct') and source_id=p_idempotency_key::text) then
    select bonus_balance into v_balance from public.credit_accounts where tenant_id=p_tenant_id;
    return jsonb_build_object('bonus_balance',coalesce(v_balance,0),'replayed',true);
  end if;
  insert into public.credit_accounts(tenant_id) values(p_tenant_id) on conflict do nothing;
  update public.credit_accounts set bonus_balance=bonus_balance+p_amount,updated_at=now()
    where tenant_id=p_tenant_id and bonus_balance+p_amount>=0
    returning bonus_balance into v_balance;
  if not found then
    raise exception 'Deduction is larger than the bonus balance';
  end if;
  insert into public.credit_ledger(tenant_id,delta,reason,source_id,bucket,actor_user_id,note)
    values(p_tenant_id,p_amount,case when p_amount>0 then 'admin_grant' else 'admin_deduct' end,
      p_idempotency_key::text,'bonus',v_actor,v_note);
  insert into public.admin_audit_log(actor_user_id,action,tenant_id,details)
    values(v_actor,case when p_amount>0 then 'credits_grant' else 'credits_deduct' end,p_tenant_id,
      jsonb_build_object('amount',p_amount,'note',v_note,'bonus_balance',v_balance));
  return jsonb_build_object('bonus_balance',v_balance,'replayed',false);
exception when unique_violation then
  -- Concurrent replay of the same key; the first call's change stands.
  return jsonb_build_object('bonus_balance',
    (select bonus_balance from public.credit_accounts where tenant_id=p_tenant_id),'replayed',true);
end;
$$;

create function public.pulse_admin_set_suspended(p_tenant_id uuid, p_suspended boolean, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := (select auth.uid()); v_reason text := nullif(btrim(coalesce(p_reason,'')),'');
  v_at timestamptz;
begin
  perform public.pulse_require_operator();
  if p_suspended and (v_reason is null or char_length(v_reason) < 3) then
    raise exception 'A reason of 3 to 500 characters is required';
  end if;
  if char_length(coalesce(v_reason,'')) > 500 then
    raise exception 'A reason of 3 to 500 characters is required';
  end if;
  update public.tenants set
    suspended_at = case when p_suspended then coalesce(suspended_at,now()) else null end,
    suspended_reason = case when p_suspended then v_reason else null end
  where id=p_tenant_id returning suspended_at into v_at;
  if not found then
    raise exception 'Business not found' using errcode='P0002';
  end if;
  insert into public.admin_audit_log(actor_user_id,action,tenant_id,details)
    values(v_actor,case when p_suspended then 'suspend' else 'unsuspend' end,p_tenant_id,
      jsonb_build_object('reason',v_reason));
  return jsonb_build_object('suspended_at',v_at,'suspended_reason',
    case when p_suspended then v_reason else null end);
end;
$$;

revoke all on function public.pulse_require_operator() from public, anon, authenticated;
revoke all on function
  public.pulse_admin_overview(), public.pulse_admin_businesses(text,text,integer,integer),
  public.pulse_admin_business(uuid), public.pulse_admin_users(text,integer,integer),
  public.pulse_admin_payments(text,text,integer,integer), public.pulse_admin_credits(text,uuid,integer,integer),
  public.pulse_admin_audit(integer,integer), public.pulse_admin_adjust_credits(uuid,integer,text,uuid),
  public.pulse_admin_set_suspended(uuid,boolean,text)
from public, anon;
grant execute on function
  public.pulse_admin_overview(), public.pulse_admin_businesses(text,text,integer,integer),
  public.pulse_admin_business(uuid), public.pulse_admin_users(text,integer,integer),
  public.pulse_admin_payments(text,text,integer,integer), public.pulse_admin_credits(text,uuid,integer,integer),
  public.pulse_admin_audit(integer,integer), public.pulse_admin_adjust_credits(uuid,integer,text,uuid),
  public.pulse_admin_set_suspended(uuid,boolean,text)
to authenticated;
