create table public.agent_versions (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  version integer not null check (version > 0),
  config jsonb not null check (jsonb_typeof(config) = 'object'),
  published_by uuid references auth.users(id),
  published_at timestamptz not null default now(),
  primary key (tenant_id, version)
);
alter table public.agent_versions enable row level security;
create policy agent_versions_read on public.agent_versions for select to authenticated
  using (public.pulse_is_member(tenant_id));
grant select on public.agent_versions to authenticated;

create or replace function public.pulse_publish_agent(p_tenant_id uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_version integer; v_draft jsonb;
begin
  if not public.pulse_is_owner(p_tenant_id) then
    raise exception 'Owner role required' using errcode = '42501';
  end if;
  update public.agent_configs set published = draft,
    published_version = published_version + 1, published_at = now(), updated_at = now()
  where tenant_id = p_tenant_id and draft_revision > 0
    and tested_revision = draft_revision
    and length(trim(coalesce(draft->>'business_name',''))) > 0
  returning published_version,draft into v_version,v_draft;
  if v_version is null then
    raise exception 'Save and test this draft before publishing' using errcode = '22023';
  end if;
  insert into public.agent_versions (tenant_id,version,config,published_by)
  values (p_tenant_id,v_version,v_draft,auth.uid());
  return v_version;
end;
$$;
