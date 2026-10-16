alter table public.tenants add column currency_code text not null default 'BDT'
  check (currency_code in ('BDT', 'USD', 'EUR', 'GBP'));

create type public.pulse_product_state as enum ('draft', 'active', 'archived');
create type public.pulse_order_state as enum
  ('draft', 'pending_confirmation', 'confirmed', 'processing', 'completed', 'cancelled');

create table public.products (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  handle text not null check (handle ~ '^[a-z0-9][a-z0-9-]{0,79}$'),
  title text not null check (length(trim(title)) between 1 and 160),
  category text not null default '',
  description text not null default '',
  state public.pulse_product_state not null default 'draft',
  media jsonb not null default '[]'::jsonb check (jsonb_typeof(media) = 'array'),
  delivery_minor bigint check (delivery_minor is null or delivery_minor >= 0),
  source_provider text not null default 'local',
  source_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, handle), unique (id, tenant_id)
);
create index products_listing_idx on public.products (tenant_id, state, updated_at desc);

create table public.product_variants (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  product_id uuid not null,
  sku text not null check (length(trim(sku)) between 1 and 80),
  options jsonb not null default '{}'::jsonb check (jsonb_typeof(options) = 'object'),
  regular_price_minor bigint not null check (regular_price_minor >= 0),
  offer_price_minor bigint check (offer_price_minor is null or
    (offer_price_minor >= 0 and offer_price_minor <= regular_price_minor)),
  stock integer not null default 0 check (stock >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, sku), unique (id, tenant_id),
  foreign key (product_id, tenant_id) references public.products(id, tenant_id) on delete cascade
);
create index product_variants_product_idx on public.product_variants (product_id, active);
create unique index product_variants_sku_ci_idx on public.product_variants (tenant_id, lower(sku));

create table public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  variant_id uuid not null,
  order_id uuid,
  delta integer not null check (delta <> 0),
  reason text not null check (length(trim(reason)) between 1 and 240),
  actor_user_id uuid references auth.users(id),
  created_at timestamptz not null default now(),
  foreign key (variant_id, tenant_id) references public.product_variants(id, tenant_id) on delete cascade
);
create index stock_movements_variant_idx on public.stock_movements (variant_id, created_at desc);

create table public.commerce_orders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  currency_code text not null,
  state public.pulse_order_state not null default 'draft',
  customer_name text not null default '',
  customer_phone text not null default '',
  delivery_address text not null default '',
  discount_type text not null default 'none' check (discount_type in ('none','amount','percent')),
  discount_value integer not null default 0 check (discount_value >= 0),
  discount_minor bigint not null default 0 check (discount_minor >= 0),
  delivery_minor bigint not null default 0 check (delivery_minor >= 0),
  subtotal_minor bigint not null default 0 check (subtotal_minor >= 0),
  total_minor bigint not null default 0 check (total_minor >= 0),
  cancellation_reason text,
  confirmed_at timestamptz,
  cancelled_at timestamptz,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, tenant_id)
);
create index commerce_orders_listing_idx on public.commerce_orders (tenant_id, created_at desc);
create index commerce_orders_state_idx on public.commerce_orders (tenant_id, state, created_at desc);

alter table public.stock_movements add constraint stock_movements_order_fk
  foreign key (order_id, tenant_id) references public.commerce_orders(id, tenant_id);

create table public.commerce_order_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  order_id uuid not null,
  variant_id uuid not null,
  product_title text not null,
  sku text not null,
  options jsonb not null default '{}'::jsonb,
  quantity integer not null check (quantity > 0),
  unit_price_minor bigint not null check (unit_price_minor >= 0),
  line_total_minor bigint not null check (line_total_minor >= 0),
  foreign key (order_id, tenant_id) references public.commerce_orders(id, tenant_id) on delete cascade,
  foreign key (variant_id, tenant_id) references public.product_variants(id, tenant_id)
);
create index commerce_order_items_order_idx on public.commerce_order_items (order_id);
create index commerce_order_items_variant_idx on public.commerce_order_items (variant_id);

create table public.commerce_payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  order_id uuid not null,
  amount_minor bigint not null check (amount_minor > 0),
  method text not null check (method in ('cash','bank','card','bkash','nagad','rocket','other')),
  note text not null default '',
  actor_user_id uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  foreign key (order_id, tenant_id) references public.commerce_orders(id, tenant_id) on delete cascade
);
create index commerce_payments_order_idx on public.commerce_payments (order_id, created_at);

create function public.pulse_set_currency(p_tenant_id uuid, p_currency text)
returns text language plpgsql security definer set search_path = '' as $$
begin
  if not public.pulse_is_owner(p_tenant_id) then raise exception 'Only owners can set currency' using errcode = '42501'; end if;
  perform 1 from public.tenants where id=p_tenant_id for update;
  if p_currency not in ('BDT','USD','EUR','GBP') then raise exception 'Unsupported currency' using errcode = '22023'; end if;
  if exists (select 1 from public.products where tenant_id = p_tenant_id) or
     exists (select 1 from public.commerce_orders where tenant_id = p_tenant_id) then
    raise exception 'Currency is locked after commerce data exists' using errcode = '22023';
  end if;
  update public.tenants set currency_code = p_currency where id = p_tenant_id;
  return p_currency;
end;
$$;

create function public.pulse_save_product(
  p_tenant_id uuid, p_id uuid, p_handle text, p_title text, p_category text,
  p_description text, p_media jsonb, p_delivery_minor bigint,
  p_state public.pulse_product_state, p_variants jsonb
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_item jsonb; v_variant_id uuid; v_seen uuid[] := '{}'; v_count integer := 0;
begin
  if not public.pulse_is_member(p_tenant_id) then raise exception 'Tenant not found' using errcode = '42501'; end if;
  perform 1 from public.tenants where id=p_tenant_id for update;
  if p_state = 'archived' then raise exception 'Use removal action to archive' using errcode = '22023'; end if;
  if p_state = 'active' and jsonb_array_length(coalesce(p_media, '[]'::jsonb)) = 0 then
    raise exception 'Active product needs an image' using errcode = '22023';
  end if;
  if jsonb_typeof(p_variants) <> 'array' or jsonb_array_length(p_variants) not between 1 and 100 then
    raise exception 'Provide 1 to 100 variants' using errcode = '22023';
  end if;
  if p_id is null then
    insert into public.products (tenant_id,handle,title,category,description,media,delivery_minor,state)
    values (p_tenant_id,p_handle,trim(p_title),coalesce(p_category,''),coalesce(p_description,''),
      coalesce(p_media,'[]'::jsonb),p_delivery_minor,p_state) returning id into v_id;
  else
    update public.products set handle=p_handle,title=trim(p_title),category=coalesce(p_category,''),
      description=coalesce(p_description,''),media=coalesce(p_media,'[]'::jsonb),
      delivery_minor=p_delivery_minor,state=p_state,updated_at=now()
    where id=p_id and tenant_id=p_tenant_id and source_provider='local' returning id into v_id;
    if v_id is null then raise exception 'Product not found or externally managed' using errcode = '42501'; end if;
  end if;
  for v_item in select * from jsonb_array_elements(p_variants) loop
    v_count := v_count + 1;
    v_variant_id := nullif(v_item->>'id','')::uuid;
    if v_variant_id is null then
      insert into public.product_variants (tenant_id,product_id,sku,options,regular_price_minor,
        offer_price_minor,stock)
      values (p_tenant_id,v_id,trim(v_item->>'sku'),coalesce(v_item->'options','{}'::jsonb),
        (v_item->>'regular_price_minor')::bigint,(v_item->>'offer_price_minor')::bigint,
        coalesce((v_item->>'stock')::integer,0)) returning id into v_variant_id;
      if (v_item->>'stock')::integer <> 0 then
        insert into public.stock_movements (tenant_id,variant_id,delta,reason,actor_user_id)
        values (p_tenant_id,v_variant_id,(v_item->>'stock')::integer,'Initial stock',auth.uid());
      end if;
    else
      update public.product_variants set sku=trim(v_item->>'sku'),
        options=coalesce(v_item->'options','{}'::jsonb),
        regular_price_minor=(v_item->>'regular_price_minor')::bigint,
        offer_price_minor=(v_item->>'offer_price_minor')::bigint,
        active=true,updated_at=now()
      where id=v_variant_id and product_id=v_id and tenant_id=p_tenant_id;
      if not found then raise exception 'Variant not found' using errcode = '22023'; end if;
    end if;
    v_seen := array_append(v_seen,v_variant_id);
  end loop;
  update public.product_variants set active=false,updated_at=now()
    where product_id=v_id and not (id=any(v_seen));
  return v_id;
end;
$$;

create function public.pulse_import_products(p_tenant_id uuid,p_products jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_item jsonb; v_count integer := 0;
begin
  if not public.pulse_is_member(p_tenant_id) then raise exception 'Tenant not found' using errcode='42501'; end if;
  if jsonb_typeof(p_products) <> 'array' or jsonb_array_length(p_products) not between 1 and 1000 then
    raise exception 'Import needs 1 to 1000 products' using errcode='22023';
  end if;
  for v_item in select * from jsonb_array_elements(p_products) loop
    perform public.pulse_save_product(p_tenant_id,null,v_item->>'handle',v_item->>'title',
      v_item->>'category',v_item->>'description',v_item->'media',
      (v_item->>'delivery_minor')::bigint,(v_item->>'state')::public.pulse_product_state,
      v_item->'variants');
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

create function public.pulse_adjust_stock(p_variant_id uuid,p_delta integer,p_reason text)
returns integer language plpgsql security definer set search_path = '' as $$
declare v public.product_variants;
begin
  select * into v from public.product_variants where id=p_variant_id for update;
  if not found or not public.pulse_is_member(v.tenant_id) then raise exception 'Variant not found' using errcode='42501'; end if;
  if p_delta = 0 or v.stock + p_delta < 0 or length(trim(coalesce(p_reason,''))) not between 1 and 240 then
    raise exception 'Invalid stock adjustment' using errcode='22023';
  end if;
  update public.product_variants set stock=stock+p_delta,updated_at=now() where id=p_variant_id;
  insert into public.stock_movements (tenant_id,variant_id,delta,reason,actor_user_id)
    values (v.tenant_id,p_variant_id,p_delta,trim(p_reason),auth.uid());
  return v.stock+p_delta;
end;
$$;

create function public.pulse_remove_product(p_product_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare v public.products;
begin
  select * into v from public.products where id=p_product_id for update;
  if not found or not public.pulse_is_member(v.tenant_id) then raise exception 'Product not found' using errcode='42501'; end if;
  if exists (select 1 from public.commerce_order_items i join public.product_variants pv
    on pv.id=i.variant_id where pv.product_id=p_product_id) then
    update public.products set state='archived',updated_at=now() where id=p_product_id;
    return 'archived';
  end if;
  delete from public.products where id=p_product_id;
  return 'deleted';
end;
$$;

create function public.pulse_restore_product(p_product_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v public.products;
begin
  select * into v from public.products where id=p_product_id;
  if not found or not public.pulse_is_member(v.tenant_id) then raise exception 'Product not found' using errcode='42501'; end if;
  update public.products set state='draft',updated_at=now() where id=p_product_id and state='archived';
  return p_product_id;
end;
$$;

create function public.pulse_save_order(
  p_tenant_id uuid,p_id uuid,p_customer_name text,p_customer_phone text,
  p_delivery_address text,p_discount_type text,p_discount_value integer,
  p_delivery_minor bigint,p_items jsonb
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_order public.commerce_orders; v_currency text; v_item jsonb; v_variant public.product_variants;
  v_product public.products; v_qty integer; v_price bigint; v_subtotal bigint := 0;
  v_discount bigint; v_total bigint;
begin
  if not public.pulse_is_member(p_tenant_id) then raise exception 'Tenant not found' using errcode='42501'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 100 then
    raise exception 'Provide 1 to 100 catalog items' using errcode='22023';
  end if;
  if p_discount_type not in ('none','amount','percent') or p_discount_value < 0 or
     (p_discount_type='percent' and p_discount_value>10000) or p_delivery_minor < 0 then
    raise exception 'Invalid totals' using errcode='22023';
  end if;
  select currency_code into v_currency from public.tenants where id=p_tenant_id for update;
  if p_id is not null then
    select * into v_order from public.commerce_orders where id=p_id and tenant_id=p_tenant_id for update;
    if not found or v_order.state <> 'draft' then raise exception 'Only draft orders can be edited' using errcode='22023'; end if;
    delete from public.commerce_order_items where order_id=p_id;
  else
    insert into public.commerce_orders (tenant_id,currency_code,created_by)
      values (p_tenant_id,v_currency,auth.uid()) returning * into v_order;
  end if;
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := (v_item->>'quantity')::integer;
    if v_qty <= 0 then raise exception 'Invalid quantity' using errcode='22023'; end if;
    select * into v_variant from public.product_variants where id=(v_item->>'variant_id')::uuid
      and tenant_id=p_tenant_id and active=true;
    if not found then raise exception 'Variant unavailable' using errcode='22023'; end if;
    select * into v_product from public.products where id=v_variant.product_id and state='active';
    if not found then raise exception 'Product unavailable' using errcode='22023'; end if;
    v_price := coalesce(v_variant.offer_price_minor,v_variant.regular_price_minor);
    v_subtotal := v_subtotal + v_price*v_qty;
    insert into public.commerce_order_items (tenant_id,order_id,variant_id,product_title,sku,
      options,quantity,unit_price_minor,line_total_minor)
    values (p_tenant_id,v_order.id,v_variant.id,v_product.title,v_variant.sku,v_variant.options,
      v_qty,v_price,v_price*v_qty);
  end loop;
  if p_discount_type='percent' then v_discount := round(v_subtotal*p_discount_value/10000.0);
  elsif p_discount_type='amount' then v_discount := p_discount_value;
  else v_discount := 0; end if;
  if v_discount > v_subtotal then raise exception 'Discount exceeds subtotal' using errcode='22023'; end if;
  v_total := v_subtotal-v_discount+p_delivery_minor;
  update public.commerce_orders set customer_name=coalesce(p_customer_name,''),
    customer_phone=coalesce(p_customer_phone,''),delivery_address=coalesce(p_delivery_address,''),
    discount_type=p_discount_type,discount_value=p_discount_value,discount_minor=v_discount,
    delivery_minor=p_delivery_minor,subtotal_minor=v_subtotal,total_minor=v_total,updated_at=now()
    where id=v_order.id;
  return v_order.id;
end;
$$;

create function public.pulse_order_action(p_order_id uuid,p_action text,p_reason text default null)
returns public.commerce_orders language plpgsql security definer set search_path = '' as $$
declare v public.commerce_orders; v_item public.commerce_order_items; v_variant public.product_variants;
  v_price bigint;
begin
  select * into v from public.commerce_orders where id=p_order_id for update;
  if not found or not public.pulse_is_member(v.tenant_id) then raise exception 'Order not found' using errcode='42501'; end if;
  if p_action='submit' and v.state='draft' then
    if length(trim(v.customer_name))=0 or length(trim(v.customer_phone))=0 or
       length(trim(v.delivery_address))=0 then raise exception 'Customer details required' using errcode='22023'; end if;
    update public.commerce_orders set state='pending_confirmation',updated_at=now() where id=p_order_id;
  elsif p_action='edit' and v.state='pending_confirmation' then
    update public.commerce_orders set state='draft',updated_at=now() where id=p_order_id;
  elsif p_action='confirm' and v.state='pending_confirmation' then
    -- Ordered row locks prevent two confirmations from overselling or deadlocking.
    for v_item in select * from public.commerce_order_items where order_id=p_order_id order by variant_id loop
      select * into v_variant from public.product_variants where id=v_item.variant_id for update;
      if not found or not v_variant.active or v_variant.stock < v_item.quantity then
        raise exception 'Stock changed; review order' using errcode='22023';
      end if;
      if not exists (select 1 from public.products where id=v_variant.product_id and state='active') then
        raise exception 'Product changed; review order' using errcode='22023';
      end if;
      v_price := coalesce(v_variant.offer_price_minor,v_variant.regular_price_minor);
      if v_price <> v_item.unit_price_minor then
        raise exception 'Price changed; review order' using errcode='22023';
      end if;
      update public.product_variants set stock=stock-v_item.quantity,updated_at=now()
        where id=v_item.variant_id;
      insert into public.stock_movements (tenant_id,variant_id,order_id,delta,reason,actor_user_id)
        values (v.tenant_id,v_item.variant_id,p_order_id,-v_item.quantity,'Order confirmed',auth.uid());
    end loop;
    update public.commerce_orders set state='confirmed',confirmed_at=now(),updated_at=now()
      where id=p_order_id;
  elsif p_action='process' and v.state='confirmed' then
    update public.commerce_orders set state='processing',updated_at=now() where id=p_order_id;
  elsif p_action='complete' and v.state='processing' then
    update public.commerce_orders set state='completed',updated_at=now() where id=p_order_id;
  elsif p_action='cancel' and v.state in ('draft','pending_confirmation','confirmed','processing') then
    if length(trim(coalesce(p_reason,'')))=0 then raise exception 'Cancellation reason required' using errcode='22023'; end if;
    if v.state in ('confirmed','processing') then
      for v_item in select * from public.commerce_order_items where order_id=p_order_id order by variant_id loop
        update public.product_variants set stock=stock+v_item.quantity,updated_at=now()
          where id=v_item.variant_id;
        insert into public.stock_movements (tenant_id,variant_id,order_id,delta,reason,actor_user_id)
          values (v.tenant_id,v_item.variant_id,p_order_id,v_item.quantity,'Order cancelled',auth.uid());
      end loop;
    end if;
    update public.commerce_orders set state='cancelled',cancellation_reason=trim(p_reason),
      cancelled_at=now(),updated_at=now() where id=p_order_id;
  else
    raise exception 'Invalid order transition' using errcode='22023';
  end if;
  select * into v from public.commerce_orders where id=p_order_id;
  return v;
end;
$$;

create function public.pulse_record_payment(p_order_id uuid,p_amount_minor bigint,p_method text,p_note text default '')
returns uuid language plpgsql security definer set search_path = '' as $$
declare v public.commerce_orders; v_paid bigint; v_id uuid;
begin
  select * into v from public.commerce_orders where id=p_order_id for update;
  if not found or not public.pulse_is_member(v.tenant_id) then raise exception 'Order not found' using errcode='42501'; end if;
  if v.state not in ('confirmed','processing','completed') or p_amount_minor <= 0 or
     p_method not in ('cash','bank','card','bkash','nagad','rocket','other') then
    raise exception 'Invalid payment' using errcode='22023';
  end if;
  select coalesce(sum(amount_minor),0) into v_paid from public.commerce_payments where order_id=p_order_id;
  if v_paid+p_amount_minor > v.total_minor then raise exception 'Payment exceeds total' using errcode='22023'; end if;
  insert into public.commerce_payments (tenant_id,order_id,amount_minor,method,note,actor_user_id)
    values (v.tenant_id,p_order_id,p_amount_minor,p_method,coalesce(p_note,''),auth.uid()) returning id into v_id;
  return v_id;
end;
$$;

alter table public.products enable row level security;
alter table public.product_variants enable row level security;
alter table public.stock_movements enable row level security;
alter table public.commerce_orders enable row level security;
alter table public.commerce_order_items enable row level security;
alter table public.commerce_payments enable row level security;
create policy products_read on public.products for select to authenticated using (public.pulse_is_member(tenant_id));
create policy variants_read on public.product_variants for select to authenticated using (public.pulse_is_member(tenant_id));
create policy movements_read on public.stock_movements for select to authenticated using (public.pulse_is_member(tenant_id));
create policy orders_read on public.commerce_orders for select to authenticated using (public.pulse_is_member(tenant_id));
create policy items_read on public.commerce_order_items for select to authenticated using (public.pulse_is_member(tenant_id));
create policy payments_read on public.commerce_payments for select to authenticated using (public.pulse_is_member(tenant_id));
grant select on public.products,public.product_variants,public.stock_movements,
  public.commerce_orders,public.commerce_order_items,public.commerce_payments to authenticated;
revoke all on public.products,public.product_variants,public.stock_movements,
  public.commerce_orders,public.commerce_order_items,public.commerce_payments from anon;
revoke all on function public.pulse_set_currency(uuid,text),
  public.pulse_save_product(uuid,uuid,text,text,text,text,jsonb,bigint,public.pulse_product_state,jsonb),
  public.pulse_import_products(uuid,jsonb),
  public.pulse_adjust_stock(uuid,integer,text),public.pulse_remove_product(uuid),
  public.pulse_restore_product(uuid),
  public.pulse_save_order(uuid,uuid,text,text,text,text,integer,bigint,jsonb),
  public.pulse_order_action(uuid,text,text),
  public.pulse_record_payment(uuid,bigint,text,text) from public,anon;
grant execute on function public.pulse_set_currency(uuid,text),
  public.pulse_save_product(uuid,uuid,text,text,text,text,jsonb,bigint,public.pulse_product_state,jsonb),
  public.pulse_import_products(uuid,jsonb),
  public.pulse_adjust_stock(uuid,integer,text),public.pulse_remove_product(uuid),
  public.pulse_restore_product(uuid),
  public.pulse_save_order(uuid,uuid,text,text,text,text,integer,bigint,jsonb),
  public.pulse_order_action(uuid,text,text),
  public.pulse_record_payment(uuid,bigint,text,text) to authenticated;

insert into storage.buckets (id,name,public) values ('catalog-media','catalog-media',false)
  on conflict (id) do nothing;
