-- Optional courier handoff (any courier, Pathao not required), return loss records,
-- merchant integration credentials and order archiving.
-- Ported from dev/payment (order_integrations + shipment guards) without the online
-- checkout and conversational-capture pieces. Written to be safe if parts already exist.

alter table public.commerce_orders add column if not exists archived_at timestamptz;

create table if not exists public.integration_connections (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  provider text not null check (provider in ('pathao','sslcommerz')),
  environment text not null default 'sandbox' check (environment in ('sandbox','live')),
  credential_ciphertext text not null,
  status text not null default 'unverified' check (status in ('unverified','verified','disabled')),
  updated_at timestamptz not null default now(),
  unique (tenant_id, provider)
);
alter table public.integration_connections enable row level security;
revoke all on public.integration_connections from anon, authenticated;

create table if not exists public.commerce_shipments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  order_id uuid not null,
  provider text not null,
  external_id text,
  tracking_code text,
  state text not null default 'pending'
    check (state in ('pending','booked','picked_up','in_transit','delivered','returned','failed','review')),
  cod_minor bigint not null check (cod_minor >= 0),
  last_provider_event jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (order_id, provider),
  foreign key (order_id, tenant_id) references public.commerce_orders(id, tenant_id)
);
alter table public.commerce_shipments enable row level security;
drop policy if exists shipments_read on public.commerce_shipments;
create policy shipments_read on public.commerce_shipments for select to authenticated
  using (public.pulse_is_member(tenant_id));
grant select on public.commerce_shipments to authenticated;
revoke all on public.commerce_shipments from anon;

-- Any courier, chosen manually. `provider` holds the courier code.
alter table public.commerce_shipments drop constraint if exists commerce_shipments_provider_check;
alter table public.commerce_shipments drop constraint if exists commerce_shipments_courier_check;
alter table public.commerce_shipments add constraint commerce_shipments_courier_check
  check (provider in ('pathao','steadfast','redx','paperfly','ecourier','sundarban','own_rider','other'));
alter table public.commerce_shipments add column if not exists courier_name text
  check (courier_name is null or length(trim(courier_name)) between 1 and 80);
alter table public.commerce_shipments add column if not exists delivery_fee_minor bigint
  check (delivery_fee_minor is null or delivery_fee_minor >= 0);
alter table public.commerce_shipments add column if not exists returned_at timestamptz;
alter table public.commerce_shipments add column if not exists return_note text
  check (return_note is null or length(return_note) <= 500);
alter table public.commerce_shipments add column if not exists damage_loss_minor bigint not null default 0
  check (damage_loss_minor >= 0);
create unique index if not exists commerce_shipments_one_per_order on public.commerce_shipments (order_id);
create index if not exists commerce_shipments_report_idx on public.commerce_shipments (tenant_id, created_at desc);

create table if not exists public.commerce_shipment_return_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  shipment_id uuid not null references public.commerce_shipments(id) on delete cascade,
  order_item_id uuid not null references public.commerce_order_items(id) on delete cascade,
  damaged_quantity integer not null check (damaged_quantity > 0),
  unique (shipment_id, order_item_id)
);
alter table public.commerce_shipment_return_items enable row level security;
drop policy if exists shipment_return_items_read on public.commerce_shipment_return_items;
create policy shipment_return_items_read on public.commerce_shipment_return_items for select to authenticated
  using (public.pulse_is_member(tenant_id));
grant select on public.commerce_shipment_return_items to authenticated;
revoke all on public.commerce_shipment_return_items from anon;

drop function if exists public.pulse_prepare_pathao_shipment(uuid,uuid);
drop function if exists public.pulse_record_pathao_booking(uuid,uuid,text,text);
drop function if exists public.pulse_record_pathao_status(uuid,uuid,text);

create or replace function public.pulse_courier_handoff(p_tenant_id uuid,p_order_id uuid,
  p_courier text,p_courier_name text,p_tracking_code text,p_delivery_fee_minor bigint)
returns public.commerce_shipments language plpgsql security definer set search_path = '' as $$
declare v_order public.commerce_orders; v_paid bigint; v_cod bigint; v_name text; v_tracking text;
  v_result public.commerce_shipments;
begin
  if not public.pulse_admin_allowed(p_tenant_id) then
    raise exception 'Shipment management access required' using errcode='42501';
  end if;
  if p_courier is null or p_courier not in
     ('pathao','steadfast','redx','paperfly','ecourier','sundarban','own_rider','other') then
    raise exception 'Choose a courier' using errcode='22023';
  end if;
  v_name := nullif(trim(coalesce(p_courier_name,'')),'');
  if p_courier='other' and (v_name is null or length(v_name)>80) then
    raise exception 'Enter the courier name' using errcode='22023';
  end if;
  if p_courier<>'other' then v_name := null; end if;
  v_tracking := nullif(trim(coalesce(p_tracking_code,'')),'');
  if length(v_tracking)>100 then raise exception 'Tracking code is too long' using errcode='22023'; end if;
  if p_delivery_fee_minor is not null and p_delivery_fee_minor<0 then
    raise exception 'Delivery fee cannot be negative' using errcode='22023';
  end if;
  select * into v_order from public.commerce_orders
    where id=p_order_id and tenant_id=p_tenant_id for update;
  if not found or v_order.state not in ('confirmed','processing') then
    raise exception 'A confirmed order is required' using errcode='22023';
  end if;
  select coalesce(sum(amount_minor),0) into v_paid from public.commerce_payments where order_id=p_order_id;
  v_cod := greatest(0,v_order.total_minor-v_paid);
  select * into v_result from public.commerce_shipments where order_id=p_order_id for update;
  if found then
    if v_result.state in ('delivered','returned') then
      raise exception 'This shipment is closed' using errcode='22023';
    end if;
    update public.commerce_shipments set provider=p_courier,courier_name=v_name,
      tracking_code=v_tracking,delivery_fee_minor=p_delivery_fee_minor,cod_minor=v_cod,
      state=case when state='pending' then 'booked' else state end,updated_at=now()
      where id=v_result.id returning * into v_result;
  else
    insert into public.commerce_shipments(tenant_id,order_id,provider,courier_name,tracking_code,
      delivery_fee_minor,cod_minor,state)
      values(p_tenant_id,p_order_id,p_courier,v_name,v_tracking,p_delivery_fee_minor,v_cod,'booked')
      returning * into v_result;
  end if;
  insert into public.activity_events(tenant_id,actor_user_id,action,subject_type,subject_id,details)
    values(p_tenant_id,auth.uid(),'courier_handoff_recorded','commerce_shipments',v_result.id,
      jsonb_build_object('courier',p_courier,'courier_name',v_name,'tracking_code',v_tracking));
  return v_result;
end;
$$;
revoke all on function public.pulse_courier_handoff(uuid,uuid,text,text,text,bigint) from public,anon;
grant execute on function public.pulse_courier_handoff(uuid,uuid,text,text,text,bigint) to authenticated;

create or replace function public.pulse_courier_status(p_tenant_id uuid,p_order_id uuid,p_state text)
returns public.commerce_shipments language plpgsql security definer set search_path = '' as $$
declare v_result public.commerce_shipments;
begin
  if not public.pulse_admin_allowed(p_tenant_id) then
    raise exception 'Shipment management access required' using errcode='42501';
  end if;
  if p_state is null or p_state not in ('picked_up','in_transit','delivered','failed','review') then
    raise exception 'Invalid shipment status' using errcode='22023';
  end if;
  select * into v_result from public.commerce_shipments
    where tenant_id=p_tenant_id and order_id=p_order_id for update;
  if not found or v_result.state='pending' then
    raise exception 'Hand the order to a courier first' using errcode='22023';
  end if;
  if v_result.state in ('delivered','returned') or (v_result.state='failed' and p_state<>'failed') then
    raise exception 'Final shipment status cannot be changed; record a return instead' using errcode='22023';
  end if;
  if v_result.state=p_state then return v_result; end if;
  update public.commerce_shipments set state=p_state,
    last_provider_event=jsonb_build_object('source','manual','recorded_by',auth.uid()),updated_at=now()
    where id=v_result.id returning * into v_result;
  insert into public.activity_events(tenant_id,actor_user_id,action,subject_type,subject_id,details)
    values(p_tenant_id,auth.uid(),'courier_status_recorded','commerce_shipments',v_result.id,
      jsonb_build_object('state',p_state));
  return v_result;
end;
$$;
revoke all on function public.pulse_courier_status(uuid,uuid,text) from public,anon;
grant execute on function public.pulse_courier_status(uuid,uuid,text) to authenticated;

-- A returned parcel cancels the order and restocks every unit not marked damaged.
create or replace function public.pulse_courier_return(p_tenant_id uuid,p_order_id uuid,
  p_damaged jsonb,p_damage_loss_minor bigint,p_delivery_fee_minor bigint,p_note text)
returns public.commerce_shipments language plpgsql security definer set search_path = '' as $$
declare v_order public.commerce_orders; v_result public.commerce_shipments;
  v_line jsonb; v_item public.commerce_order_items; v_qty integer; v_damaged integer; v_restore integer;
begin
  if not public.pulse_admin_allowed(p_tenant_id) then
    raise exception 'Shipment management access required' using errcode='42501';
  end if;
  if p_damaged is null or jsonb_typeof(p_damaged)<>'array' or
     coalesce(p_damage_loss_minor,-1)<0 or coalesce(p_delivery_fee_minor,0)<0 or
     length(coalesce(p_note,''))>500 then
    raise exception 'Invalid return details' using errcode='22023';
  end if;
  select * into v_order from public.commerce_orders
    where id=p_order_id and tenant_id=p_tenant_id for update;
  if not found or v_order.state not in ('confirmed','processing') then
    raise exception 'Only an open confirmed order can be returned' using errcode='22023';
  end if;
  select * into v_result from public.commerce_shipments where order_id=p_order_id for update;
  if not found or v_result.state in ('pending','delivered','returned') then
    raise exception 'No courier handoff can be returned for this order' using errcode='22023';
  end if;
  update public.commerce_shipments set state='returned',returned_at=now(),
    return_note=nullif(trim(coalesce(p_note,'')),''),damage_loss_minor=p_damage_loss_minor,
    delivery_fee_minor=coalesce(p_delivery_fee_minor,delivery_fee_minor),
    last_provider_event=jsonb_build_object('source','manual','recorded_by',auth.uid()),updated_at=now()
    where id=v_result.id returning * into v_result;
  for v_line in select * from jsonb_array_elements(p_damaged) loop
    if jsonb_typeof(v_line)<>'object' or jsonb_typeof(v_line->'quantity')<>'number' then
      raise exception 'Invalid damaged item' using errcode='22023';
    end if;
    v_qty := (v_line->>'quantity')::integer;
    select * into v_item from public.commerce_order_items
      where id=(v_line->>'item_id')::uuid and order_id=p_order_id;
    if not found or v_qty<1 or v_qty>v_item.quantity then
      raise exception 'Damaged quantity must match an order item' using errcode='22023';
    end if;
    insert into public.commerce_shipment_return_items(tenant_id,shipment_id,order_item_id,damaged_quantity)
      values(p_tenant_id,v_result.id,v_item.id,v_qty);
  end loop;
  for v_item in select * from public.commerce_order_items where order_id=p_order_id order by variant_id loop
    select coalesce(sum(damaged_quantity),0) into v_damaged from public.commerce_shipment_return_items
      where shipment_id=v_result.id and order_item_id=v_item.id;
    v_restore := v_item.quantity-v_damaged;
    if v_restore>0 then
      update public.product_variants set stock=stock+v_restore,updated_at=now() where id=v_item.variant_id;
      insert into public.stock_movements(tenant_id,variant_id,order_id,delta,reason,actor_user_id)
        values(p_tenant_id,v_item.variant_id,p_order_id,v_restore,'Courier return',auth.uid());
    end if;
  end loop;
  update public.commerce_orders set state='cancelled',cancellation_reason='Courier return',
    cancelled_at=now(),updated_at=now() where id=p_order_id;
  insert into public.activity_events(tenant_id,actor_user_id,action,subject_type,subject_id,details)
    values(p_tenant_id,auth.uid(),'courier_return_recorded','commerce_shipments',v_result.id,
      jsonb_build_object('damage_loss_minor',p_damage_loss_minor,'delivery_fee_minor',v_result.delivery_fee_minor));
  return v_result;
end;
$$;
revoke all on function public.pulse_courier_return(uuid,uuid,jsonb,bigint,bigint,text) from public,anon;
grant execute on function public.pulse_courier_return(uuid,uuid,jsonb,bigint,bigint,text) to authenticated;

create or replace function public.pulse_courier_returns_report(p_tenant_id uuid,p_days integer default 30)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_start timestamptz;
begin
  if not public.pulse_is_member(p_tenant_id) then
    raise exception 'Tenant not found' using errcode='42501';
  end if;
  if p_days not in (7,30,90) then raise exception 'Unsupported period' using errcode='22023'; end if;
  v_start := ((now() at time zone 'Asia/Dhaka')::date - (p_days-1))::timestamp at time zone 'Asia/Dhaka';
  return (with s as (
    select sh.*, o.total_minor, o.customer_name, o.customer_phone
    from public.commerce_shipments sh join public.commerce_orders o on o.id=sh.order_id
    where sh.tenant_id=p_tenant_id and sh.state<>'pending' and sh.created_at>=v_start
  ) select jsonb_build_object(
    'days',p_days,
    'currency',(select currency_code from public.tenants where id=p_tenant_id),
    'couriers',coalesce((select jsonb_agg(c order by c.returned desc, c.handoffs desc) from (
      select provider as courier, courier_name, count(*) as handoffs,
        count(*) filter (where state='delivered') as delivered,
        count(*) filter (where state='returned') as returned,
        coalesce(sum(delivery_fee_minor) filter (where state='returned'),0) as delivery_fees_lost_minor,
        coalesce(sum(damage_loss_minor) filter (where state='returned'),0) as damage_loss_minor,
        coalesce(sum(total_minor) filter (where state='returned'),0) as sale_value_lost_minor
      from s group by provider, courier_name) c),'[]'::jsonb),
    'returns',coalesce((select jsonb_agg(r order by r.returned_at desc) from (
      select s.id, s.order_id, s.provider as courier, s.courier_name, s.tracking_code, s.returned_at,
        s.return_note, s.delivery_fee_minor, s.damage_loss_minor, s.total_minor as sale_value_minor,
        s.customer_name, s.customer_phone,
        coalesce((select jsonb_agg(jsonb_build_object('product_title',i.product_title,'sku',i.sku,
          'damaged_quantity',ri.damaged_quantity)) from public.commerce_shipment_return_items ri
          join public.commerce_order_items i on i.id=ri.order_item_id where ri.shipment_id=s.id),'[]'::jsonb) as damaged_items
      from s where s.state='returned' limit 200) r),'[]'::jsonb)
  ) from (select 1) one);
end;
$$;
revoke all on function public.pulse_courier_returns_report(uuid,integer) from public,anon;
grant execute on function public.pulse_courier_returns_report(uuid,integer) to authenticated;

-- Recompute COD from recorded payments when a booking is made.
create or replace function public.pulse_shipment_payment_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_total bigint; v_paid bigint; v_state public.pulse_order_state;
begin
  if new.state='booked' then
    select total_minor,state into v_total,v_state from public.commerce_orders where id=new.order_id;
    if v_state not in ('confirmed','processing') then
      raise exception 'Order is no longer ready for courier booking' using errcode='22023';
    end if;
    select coalesce(sum(amount_minor),0) into v_paid from public.commerce_payments
      where order_id=new.order_id;
    new.cod_minor := greatest(0,v_total-v_paid);
  end if;
  return new;
end;
$$;
drop trigger if exists shipment_payment_guard on public.commerce_shipments;
create trigger shipment_payment_guard before insert or update of cod_minor,state
on public.commerce_shipments for each row execute function public.pulse_shipment_payment_guard();

-- Do not restore stock while a booked parcel may still be with the courier.
create or replace function public.pulse_order_shipment_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.state='cancelled' and old.state in ('confirmed','processing') and exists(
    select 1 from public.commerce_shipments where order_id=old.id
      and state in ('booked','picked_up','in_transit','delivered','failed','review')
  ) then
    raise exception 'Resolve the courier return before cancelling this order'
      using errcode='22023';
  end if;
  return new;
end;
$$;
drop trigger if exists order_shipment_guard on public.commerce_orders;
create trigger order_shipment_guard before update of state on public.commerce_orders
for each row execute function public.pulse_order_shipment_guard();

create or replace function public.pulse_archive_order(p_tenant_id uuid, p_order_id uuid, p_archive boolean)
returns public.commerce_orders language plpgsql security definer set search_path = '' as $$
declare v_order public.commerce_orders;
begin
  if not public.pulse_admin_allowed(p_tenant_id) then
    raise exception 'Order management access required' using errcode='42501';
  end if;
  select * into v_order from public.commerce_orders
    where id=p_order_id and tenant_id=p_tenant_id for update;
  if not found then raise exception 'Order not found' using errcode='22023'; end if;
  if p_archive and v_order.state not in ('completed','cancelled') then
    raise exception 'Complete or cancel the order before archiving' using errcode='22023';
  end if;
  update public.commerce_orders set archived_at=case when p_archive then now() else null end,
    updated_at=now() where id=p_order_id returning * into v_order;
  insert into public.activity_events(tenant_id,actor_user_id,action,subject_type,subject_id,details)
    values(p_tenant_id,auth.uid(),case when p_archive then 'order_archived' else 'order_restored' end,
      'commerce_orders',p_order_id,'{}'::jsonb);
  return v_order;
end;
$$;
revoke all on function public.pulse_archive_order(uuid,uuid,boolean) from public,anon;
grant execute on function public.pulse_archive_order(uuid,uuid,boolean) to authenticated;
