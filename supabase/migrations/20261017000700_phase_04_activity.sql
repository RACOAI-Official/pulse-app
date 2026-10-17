create table public.activity_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  actor_user_id uuid,
  action text not null,
  subject_type text not null,
  subject_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index activity_events_tenant_idx on public.activity_events (tenant_id, created_at desc);
alter table public.activity_events enable row level security;
create policy activity_events_read on public.activity_events for select to authenticated
  using (public.pulse_is_member(tenant_id));
grant select on public.activity_events to authenticated;
revoke all on public.activity_events from anon;

create function public.pulse_record_activity() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_tenant uuid; v_id uuid; v_action text;
begin
  v_tenant := case when tg_op='DELETE' then old.tenant_id else new.tenant_id end;
  v_id := case when tg_op='DELETE' then old.id else new.id end;
  v_action := lower(tg_op);
  insert into public.activity_events(tenant_id, actor_user_id, action, subject_type, subject_id)
  values(v_tenant, auth.uid(), v_action, tg_table_name, v_id);
  return coalesce(new, old);
end;
$$;
create trigger products_activity after insert or update on public.products
  for each row execute function public.pulse_record_activity();
create trigger orders_activity after insert or update on public.commerce_orders
  for each row execute function public.pulse_record_activity();
create trigger agent_activity after insert or update on public.agent_configs
  for each row execute function public.pulse_record_activity();
create trigger tickets_activity after insert or update on public.support_tickets
  for each row execute function public.pulse_record_activity();

create function public.pulse_team_performance(p_tenant_id uuid, p_days integer default 7)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_start timestamptz;
begin
  if not public.pulse_is_member(p_tenant_id) then raise exception 'Tenant not found' using errcode='42501'; end if;
  if p_days not in (7,30,90) then raise exception 'Unsupported period' using errcode='22023'; end if;
  v_start := now() - make_interval(days => p_days);
  return coalesce((select jsonb_agg(to_jsonb(x)) from (
    select m.sender_user_id as user_id, count(*) as replies,
      count(distinct m.conversation_id) as chats_handled,
      round(avg(extract(epoch from m.created_at - inbound.created_at)) / 60.0, 1) as avg_response_minutes
    from public.messages m
    left join lateral (
      select i.created_at from public.messages i
      where i.conversation_id=m.conversation_id and i.direction='inbound'
        and i.created_at <= m.created_at
      order by i.created_at desc limit 1
    ) inbound on true
    where m.tenant_id=p_tenant_id and m.sender_type='human' and m.created_at>=v_start
      and m.sender_user_id is not null
    group by m.sender_user_id order by replies desc
  ) x), '[]'::jsonb);
end;
$$;
revoke all on function public.pulse_team_performance(uuid,integer) from public,anon;
grant execute on function public.pulse_team_performance(uuid,integer) to authenticated;
