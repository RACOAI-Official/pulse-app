-- Run against local Supabase after 20261118000100_tiers_grants; this transaction rolls back.
-- psql "$DB_URL" -v ON_ERROR_STOP=1 -f apps/api/tests/tiers_grants_postgres.sql
begin;
insert into auth.users (id) values ('00000000-0000-0000-0000-00000000a001');
insert into public.platform_operators (user_id) values ('00000000-0000-0000-0000-00000000a001');
insert into public.tenants (id, name) values ('00000000-0000-0000-0000-00000000b001', 'Tier test');
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000a001', true);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000a001","role":"authenticated"}', true);

do $$
declare tenant uuid := '00000000-0000-0000-0000-00000000b001'; result jsonb;
begin
  -- Validation.
  begin
    perform public.pulse_admin_assign_plan(tenant, 'pro', 0, 'pilot', 4000);
    raise exception 'Zero months accepted';
  exception when raise_exception then
    if sqlerrm = 'Zero months accepted' then raise; end if;
  end;

  -- Assign Starter for 2 months: grant, credits and audit.
  result := public.pulse_admin_assign_plan(tenant, 'starter', 2, 'pilot partner', 1000);
end $$;

reset role;
do $$
declare tenant uuid := '00000000-0000-0000-0000-00000000b001';
begin
  if public.pulse_billing_effective_plan(tenant) <> 'starter' then raise exception 'Grant not effective'; end if;
  if not public.pulse_billing_has_access(tenant) then raise exception 'Grant has no access'; end if;
  if (select balance from public.credit_accounts where tenant_id = tenant) <> 1000 then
    raise exception 'Grant credits missing';
  end if;
  if (select count(*) from public.admin_audit_log where tenant_id = tenant and action = 'plan_assign') <> 1 then
    raise exception 'Assign not audited';
  end if;
end $$;

do $$
declare tenant uuid := '00000000-0000-0000-0000-00000000b001'; i integer;
begin
  -- Starter catalog cap: 50 non-archived products; archived ones do not count.
  for i in 1..50 loop
    insert into public.products(tenant_id, handle, title) values(tenant, 'p-' || i, 'Product ' || i);
  end loop;
  begin
    insert into public.products(tenant_id, handle, title) values(tenant, 'p-51', 'Product 51');
    raise exception 'Catalog cap not enforced';
  exception when raise_exception then
    if sqlerrm = 'Catalog cap not enforced' then raise; end if;
  end;
  update public.products set state = 'archived' where tenant_id = tenant and handle = 'p-1';
  insert into public.products(tenant_id, handle, title) values(tenant, 'p-51', 'Product 51');
  begin
    update public.products set state = 'draft' where tenant_id = tenant and handle = 'p-1';
    raise exception 'Restore over cap allowed';
  exception when raise_exception then
    if sqlerrm = 'Restore over cap allowed' then raise; end if;
  end;

  -- Roll cycles follow the grant's plan.
  update public.credit_accounts set balance = 3, cycle_end = now() - interval '1 minute' where tenant_id = tenant;
  perform public.pulse_credit_roll_cycles('{"starter":1000,"pro":4000,"enterprise":12000}'::jsonb);
  if (select balance from public.credit_accounts where tenant_id = tenant) <> 1000 then
    raise exception 'Grant cycle did not roll';
  end if;
end $$;

set local role authenticated;
do $$
declare tenant uuid := '00000000-0000-0000-0000-00000000b001'; result jsonb;
begin
  -- Re-assign upgrades in place; Business lifts the catalog cap.
  result := public.pulse_admin_assign_plan(tenant, 'pro', 3, 'upgrade pilot', 4000);
  if result->>'plan_key' <> 'pro' then raise exception 'Re-assign failed'; end if;

  -- Revoke: no plan, plan credits gone, audited.
  result := public.pulse_admin_revoke_plan(tenant, 'pilot ended');
  if result->>'revoked' <> 'pro' or result->'effective_plan' <> 'null'::jsonb then
    raise exception 'Revoke failed: %', result;
  end if;
  begin
    perform public.pulse_admin_revoke_plan(tenant, 'again');
    raise exception 'Double revoke allowed';
  exception when no_data_found then null;
  end;
end $$;

reset role;
do $$
declare tenant uuid := '00000000-0000-0000-0000-00000000b001';
begin
  if (select balance from public.credit_accounts where tenant_id = tenant) <> 0 then
    raise exception 'Revoke kept plan credits';
  end if;
  if (select count(*) from public.admin_audit_log where tenant_id = tenant and action = 'plan_revoke') <> 1 then
    raise exception 'Revoke not audited';
  end if;
  if (select count(*) from public.billing_operator_grants where tenant_id = tenant) <> 0 then
    raise exception 'Grant row kept';
  end if;
end $$;

-- Non-operators cannot assign.
insert into auth.users (id) values ('00000000-0000-0000-0000-00000000a002');
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000a002', true);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000a002","role":"authenticated"}', true);
do $$
begin
  perform public.pulse_admin_assign_plan('00000000-0000-0000-0000-00000000b001', 'enterprise', 12, 'sneaky', 12000);
  raise exception 'Non-operator assigned a plan';
exception when raise_exception or insufficient_privilege then
  if sqlerrm = 'Non-operator assigned a plan' then raise; end if;
end $$;
select 'tiers_grants_postgres ok' as result;
rollback;
