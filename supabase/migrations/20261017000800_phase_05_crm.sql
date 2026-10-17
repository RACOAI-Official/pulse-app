create table public.customer_profiles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  display_name text not null default '',
  phone text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, tenant_id)
);
create index customer_profiles_tenant_idx on public.customer_profiles (tenant_id, updated_at desc);
alter table public.conversations add column customer_id uuid;
alter table public.conversations add constraint conversations_customer_fk
  foreign key (customer_id, tenant_id) references public.customer_profiles(id, tenant_id);
create index conversations_customer_idx on public.conversations (customer_id, last_message_at desc);

create function public.pulse_profile_for_conversation() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  insert into public.customer_profiles(tenant_id, display_name)
  values(new.tenant_id, coalesce(nullif(new.customer_name, ''), 'Customer'))
  returning id into v_id;
  update public.conversations set customer_id=v_id where id=new.id;
  return new;
end;
$$;
create trigger conversation_profile after insert on public.conversations
  for each row execute function public.pulse_profile_for_conversation();

do $$
declare v public.conversations; v_id uuid;
begin
  for v in select * from public.conversations where customer_id is null loop
    insert into public.customer_profiles(tenant_id, display_name)
      values(v.tenant_id, coalesce(nullif(v.customer_name, ''), 'Customer'))
      returning id into v_id;
    update public.conversations set customer_id=v_id where id=v.id;
  end loop;
end;
$$;

create function public.pulse_link_customer(p_tenant_id uuid, p_conversation_id uuid, p_customer_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
begin
  if not public.pulse_is_member(p_tenant_id) then raise exception 'Tenant not found' using errcode='42501'; end if;
  if not exists(select 1 from public.customer_profiles where id=p_customer_id and tenant_id=p_tenant_id) then
    raise exception 'Customer not found' using errcode='22023';
  end if;
  update public.conversations set customer_id=p_customer_id
  where id=p_conversation_id and tenant_id=p_tenant_id;
  if not found then raise exception 'Conversation not found' using errcode='22023'; end if;
  return p_customer_id;
end;
$$;

create function public.pulse_update_customer(p_tenant_id uuid, p_customer_id uuid,
  p_name text, p_phone text)
returns uuid language plpgsql security definer set search_path = '' as $$
begin
  if not public.pulse_is_member(p_tenant_id) then raise exception 'Tenant not found' using errcode='42501'; end if;
  if length(trim(p_name)) not between 1 and 160 or length(p_phone) > 40 then
    raise exception 'Invalid customer details' using errcode='22023';
  end if;
  update public.customer_profiles set display_name=trim(p_name), phone=trim(p_phone), updated_at=now()
  where id=p_customer_id and tenant_id=p_tenant_id;
  if not found then raise exception 'Customer not found' using errcode='22023'; end if;
  return p_customer_id;
end;
$$;

alter table public.customer_profiles enable row level security;
create policy customer_profiles_read on public.customer_profiles for select to authenticated
  using (public.pulse_is_member(tenant_id));
grant select on public.customer_profiles to authenticated;
revoke all on public.customer_profiles from anon;
revoke all on function public.pulse_link_customer(uuid,uuid,uuid),
  public.pulse_update_customer(uuid,uuid,text,text) from public,anon;
grant execute on function public.pulse_link_customer(uuid,uuid,uuid),
  public.pulse_update_customer(uuid,uuid,text,text) to authenticated;
