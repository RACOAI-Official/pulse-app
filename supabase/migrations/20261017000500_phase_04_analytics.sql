create or replace function public.pulse_analytics(p_tenant_id uuid, p_days integer default 7)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_start timestamptz;
  v_result jsonb;
begin
  if not public.pulse_is_member(p_tenant_id) then
    raise exception 'Tenant not found' using errcode = '42501';
  end if;
  if p_days not in (7, 30, 90) then
    raise exception 'Unsupported period' using errcode = '22023';
  end if;
  v_start := ((now() at time zone 'Asia/Dhaka')::date - (p_days - 1))::timestamp at time zone 'Asia/Dhaka';

  with daily as (
    select day::date as day,
      (select count(*) from public.messages m where m.tenant_id = p_tenant_id
        and m.direction = 'inbound' and (m.created_at at time zone 'Asia/Dhaka')::date = day::date) as received,
      (select count(*) from public.messages m where m.tenant_id = p_tenant_id
        and m.sender_type = 'ai' and (m.created_at at time zone 'Asia/Dhaka')::date = day::date) as ai_replies,
      (select count(*) from public.messages m where m.tenant_id = p_tenant_id
        and m.sender_type = 'human' and (m.created_at at time zone 'Asia/Dhaka')::date = day::date) as human_replies,
      (select count(*) from public.commerce_orders o where o.tenant_id = p_tenant_id
        and o.confirmed_at is not null and o.state <> 'cancelled'
        and (o.confirmed_at at time zone 'Asia/Dhaka')::date = day::date) as orders,
      (select coalesce(sum(o.total_minor), 0) from public.commerce_orders o
        where o.tenant_id = p_tenant_id and o.confirmed_at is not null and o.state <> 'cancelled'
        and (o.confirmed_at at time zone 'Asia/Dhaka')::date = day::date) as sales_minor
    from generate_series((now() at time zone 'Asia/Dhaka')::date - (p_days - 1),
      (now() at time zone 'Asia/Dhaka')::date, interval '1 day') day
  ),
  totals as (
    select coalesce(sum(received), 0) as received, coalesce(sum(ai_replies), 0) as ai_replies,
      coalesce(sum(human_replies), 0) as human_replies, coalesce(sum(orders), 0) as orders,
      coalesce(sum(sales_minor), 0) as sales_minor from daily
  )
  select jsonb_build_object(
    'days', p_days, 'timezone', 'Asia/Dhaka',
    'currency', (select currency_code from public.tenants where id = p_tenant_id),
    'totals', (select jsonb_build_object('received', received, 'ai_replies', ai_replies,
      'human_replies', human_replies, 'orders', orders, 'sales_minor', sales_minor,
      'automation_percent', case when ai_replies + human_replies = 0 then 0
        else round(100.0 * ai_replies / (ai_replies + human_replies)) end) from totals),
    'today', (select to_jsonb(d) - 'day' from daily d order by day desc limit 1),
    'daily', coalesce((select jsonb_agg(to_jsonb(d) order by day) from daily d), '[]'::jsonb),
    'active_conversations', (select count(*) from public.conversations c where c.tenant_id = p_tenant_id
      and c.last_message_at >= v_start),
    'pending_orders', (select count(*) from public.commerce_orders o where o.tenant_id = p_tenant_id
      and o.state in ('draft', 'pending_confirmation')),
    'channels', coalesce((select jsonb_agg(to_jsonb(x)) from (
      select channel, count(*) as received from public.messages
      where tenant_id = p_tenant_id and direction = 'inbound' and created_at >= v_start
      group by channel order by channel) x), '[]'::jsonb),
    'top_products', coalesce((select jsonb_agg(to_jsonb(x)) from (
      select i.product_title as title, sum(i.quantity) as units
      from public.commerce_order_items i join public.commerce_orders o on o.id = i.order_id
      where i.tenant_id = p_tenant_id and o.confirmed_at >= v_start and o.state <> 'cancelled'
      group by i.product_title order by units desc, title limit 5) x), '[]'::jsonb),
    'top_customers', coalesce((select jsonb_agg(to_jsonb(x)) from (
      select coalesce(nullif(o.customer_name, ''), 'Unnamed customer') as name,
        count(*) as orders, sum(o.total_minor) as sales_minor
      from public.commerce_orders o where o.tenant_id = p_tenant_id and o.confirmed_at >= v_start
        and o.state <> 'cancelled'
      group by coalesce(nullif(o.customer_name, ''), 'Unnamed customer'), o.customer_phone
      order by sales_minor desc, name limit 5) x), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;

revoke all on function public.pulse_analytics(uuid, integer) from public, anon;
grant execute on function public.pulse_analytics(uuid, integer) to authenticated;
