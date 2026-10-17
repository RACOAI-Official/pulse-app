-- Run with psql -v ON_ERROR_STOP=1 -f apps/api/tests/agent_rls_postgres.sql.
-- Uses a synthetic auth user and rolls back every change.
begin;
select gen_random_uuid() as test_user, gen_random_uuid() as own_tenant,
  gen_random_uuid() as other_tenant \gset
insert into auth.users (id) values (:'test_user');
insert into public.tenants (id,name) values
  (:'own_tenant','Own test tenant'),(:'other_tenant','Other test tenant');
insert into public.memberships (tenant_id,user_id,role)
values (:'own_tenant',:'test_user','owner');
insert into public.agent_configs (tenant_id,draft)
values (:'other_tenant','{"business_name":"Private other tenant"}');

set local role authenticated;
select set_config('request.jwt.claim.sub',:'test_user',true);
select set_config('app.test_own_tenant',:'own_tenant',true);
select set_config('app.test_other_tenant',:'other_tenant',true);
do $$
declare v_own uuid := current_setting('app.test_own_tenant')::uuid;
  v_other uuid := current_setting('app.test_other_tenant')::uuid; v_revision integer;
begin
  if (select count(*) from public.agent_configs) <> 0 then
    raise exception 'Cross-tenant config leaked';
  end if;
  begin
    perform public.pulse_save_agent_draft(v_other,'{"business_name":"Bad"}');
    raise exception 'Cross-tenant write succeeded';
  exception when insufficient_privilege then null;
  end;
  v_revision := public.pulse_save_agent_draft(v_own,'{"business_name":"Own test"}');
  if v_revision <> 1 then raise exception 'Draft revision invalid'; end if;
  begin
    perform public.pulse_publish_agent(v_own);
    raise exception 'Untested draft published';
  exception when invalid_parameter_value then null;
  end;
  if not public.pulse_mark_agent_tested(v_own, v_revision) then
    raise exception 'Test revision not recorded';
  end if;
  if public.pulse_publish_agent(v_own) <> 1 then
    raise exception 'Published version invalid';
  end if;
  if (select count(*) from public.agent_versions where tenant_id=v_own) <> 1 then
    raise exception 'Immutable version missing';
  end if;
  perform public.pulse_set_agent_enabled(v_own,true);
  if not (select enabled from public.agent_configs where tenant_id=v_own) then
    raise exception 'Enable failed';
  end if;
end $$;
rollback;
