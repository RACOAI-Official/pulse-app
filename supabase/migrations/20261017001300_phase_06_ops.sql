create table public.platform_operators (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.platform_operators enable row level security;
create policy operators_self_read on public.platform_operators for select to authenticated
  using (user_id=auth.uid());
grant select on public.platform_operators to authenticated;
revoke all on public.platform_operators from anon;

create function public.pulse_ops_overview()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists(select 1 from public.platform_operators where user_id=auth.uid()) then
    raise exception 'Operator access required' using errcode='42501';
  end if;
  return jsonb_build_object(
    'tenants', (select count(*) from public.tenants),
    'connected_channels', (select count(*) from public.channel_connections where status='connected'),
    'failed_webhooks', (select count(*) from public.webhook_events where status='failed'),
    'problem_sends', (select count(*) from public.messages where delivery_state in ('failed','uncertain')),
    'businesses', coalesce((select jsonb_agg(to_jsonb(x)) from (
      select t.id,t.name,t.created_at,
        (select count(*) from public.channel_connections c where c.tenant_id=t.id and c.status='connected') as channels,
        (select count(*) from public.conversations c where c.tenant_id=t.id) as conversations,
        (select count(*) from public.commerce_orders o where o.tenant_id=t.id) as orders
      from public.tenants t order by t.created_at desc limit 100
    ) x), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.pulse_ops_overview() from public,anon;
grant execute on function public.pulse_ops_overview() to authenticated;
