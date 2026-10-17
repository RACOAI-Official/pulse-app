create table public.usage_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  kind text not null check (kind in ('inbound_message','ai_reply','human_reply','system_reply','confirmed_order')),
  source_id uuid not null,
  created_at timestamptz not null default now(),
  unique (kind, source_id)
);
create index usage_events_tenant_idx on public.usage_events (tenant_id, kind, created_at desc);
alter table public.usage_events enable row level security;
create policy usage_events_read on public.usage_events for select to authenticated
  using (public.pulse_is_member(tenant_id));
grant select on public.usage_events to authenticated;
revoke all on public.usage_events from anon;

create function public.pulse_meter_message() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_kind text;
begin
  v_kind := case when new.direction='inbound' then 'inbound_message'
    when new.sender_type='ai' then 'ai_reply'
    when new.sender_type='human' then 'human_reply'
    else 'system_reply' end;
  insert into public.usage_events(tenant_id,kind,source_id)
    values(new.tenant_id,v_kind,new.id) on conflict do nothing;
  return new;
end;
$$;
create trigger meter_message after insert on public.messages
  for each row execute function public.pulse_meter_message();

create function public.pulse_meter_confirmed_order() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.state='confirmed' and (tg_op='INSERT' or old.state<>'confirmed') then
    insert into public.usage_events(tenant_id,kind,source_id)
      values(new.tenant_id,'confirmed_order',new.id) on conflict do nothing;
  end if;
  return new;
end;
$$;
create trigger meter_confirmed_order after insert or update on public.commerce_orders
  for each row execute function public.pulse_meter_confirmed_order();

insert into public.usage_events(tenant_id,kind,source_id,created_at)
select tenant_id,case when direction='inbound' then 'inbound_message'
  when sender_type='ai' then 'ai_reply' when sender_type='human' then 'human_reply'
  else 'system_reply' end,id,created_at from public.messages
on conflict do nothing;
insert into public.usage_events(tenant_id,kind,source_id,created_at)
select tenant_id,'confirmed_order',id,confirmed_at from public.commerce_orders
where confirmed_at is not null on conflict do nothing;

create function public.pulse_usage_summary(p_tenant_id uuid, p_days integer default 30)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.pulse_is_member(p_tenant_id) then raise exception 'Tenant not found' using errcode='42501'; end if;
  if p_days not in (7,30,90) then raise exception 'Unsupported period' using errcode='22023'; end if;
  return coalesce((select jsonb_object_agg(kind, quantity) from (
    select kind,count(*) as quantity from public.usage_events
    where tenant_id=p_tenant_id and created_at>=now()-make_interval(days=>p_days)
    group by kind
  ) x), '{}'::jsonb);
end;
$$;
revoke all on function public.pulse_usage_summary(uuid,integer) from public,anon;
grant execute on function public.pulse_usage_summary(uuid,integer) to authenticated;
