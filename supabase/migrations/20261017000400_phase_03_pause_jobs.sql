create or replace function public.pulse_set_agent_enabled(p_tenant_id uuid, p_enabled boolean)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if not public.pulse_is_owner(p_tenant_id) then
    raise exception 'Owner role required' using errcode = '42501';
  end if;
  update public.agent_configs set enabled = p_enabled, updated_at = now()
  where tenant_id = p_tenant_id and (not p_enabled or published is not null);
  if not found then raise exception 'Publish an agent version first' using errcode = '22023'; end if;
  if not p_enabled then
    update public.agent_jobs set status='cancelled'
    where tenant_id=p_tenant_id and status='pending';
  end if;
  return p_enabled;
end;
$$;
