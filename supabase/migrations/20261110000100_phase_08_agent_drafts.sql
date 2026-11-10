-- AI orders become drafts the owner reviews; customer details are remembered on the profile.
alter table public.customer_profiles add column delivery_address text not null default '';
alter table public.commerce_orders add column seen_at timestamptz;
create index commerce_orders_unseen_agent_idx on public.commerce_orders (tenant_id)
  where source='agent' and seen_at is null;

create or replace function public.pulse_agent_create_order(
  p_tenant_id uuid, p_conversation_id uuid, p_agent_job_id uuid,
  p_customer_name text, p_customer_phone text, p_delivery_address text, p_items jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_order public.commerce_orders; v_currency text; v_item jsonb; v_variant public.product_variants;
  v_product public.products; v_qty integer; v_price bigint; v_subtotal bigint := 0;
  v_delivery bigint := 0; v_customer_id uuid; v_lines jsonb := '[]'::jsonb;
begin
  -- A retried agent job must never create a second order.
  select * into v_order from public.commerce_orders where agent_job_id=p_agent_job_id;
  if found then
    return jsonb_build_object('order_id',v_order.id,'total_minor',v_order.total_minor,
      'delivery_minor',v_order.delivery_minor,'currency',v_order.currency_code,'existing',true,
      'lines',(select coalesce(jsonb_agg(jsonb_build_object('title',product_title,'options',options,
        'quantity',quantity,'line_total_minor',line_total_minor)),'[]'::jsonb)
        from public.commerce_order_items where order_id=v_order.id));
  end if;
  if length(trim(coalesce(p_customer_name,'')))=0 or length(trim(coalesce(p_customer_phone,'')))=0 or
     length(trim(coalesce(p_delivery_address,'')))=0 then
    raise exception 'Customer details required' using errcode='22023';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 20 then
    raise exception 'Provide 1 to 20 catalog items' using errcode='22023';
  end if;
  select customer_id into v_customer_id from public.conversations
    where id=p_conversation_id and tenant_id=p_tenant_id;
  if not found then raise exception 'Conversation not found' using errcode='22023'; end if;
  select currency_code into v_currency from public.tenants where id=p_tenant_id;
  insert into public.commerce_orders (tenant_id,currency_code,created_by,source,agent_job_id,
      conversation_id,customer_id,customer_name,customer_phone,delivery_address)
    values (p_tenant_id,v_currency,null,'agent',p_agent_job_id,p_conversation_id,v_customer_id,
      left(trim(p_customer_name),160),left(trim(p_customer_phone),40),left(trim(p_delivery_address),1000))
    returning * into v_order;
  -- Draft only: stock is checked and taken when the owner confirms (pulse_order_action).
  for v_item in select value from jsonb_array_elements(p_items) order by (value->>'variant_id') loop
    v_qty := (v_item->>'quantity')::integer;
    if v_qty is null or v_qty not between 1 and 1000 then raise exception 'Invalid quantity' using errcode='22023'; end if;
    select * into v_variant from public.product_variants where id=(v_item->>'variant_id')::uuid
      and tenant_id=p_tenant_id and active=true;
    if not found then raise exception 'Variant unavailable' using errcode='22023'; end if;
    select * into v_product from public.products where id=v_variant.product_id and state='active';
    if not found then raise exception 'Product unavailable' using errcode='22023'; end if;
    v_price := coalesce(v_variant.offer_price_minor,v_variant.regular_price_minor);
    v_subtotal := v_subtotal + v_price*v_qty;
    v_delivery := greatest(v_delivery, coalesce(v_product.delivery_minor,0));
    insert into public.commerce_order_items (tenant_id,order_id,variant_id,product_title,sku,
      options,quantity,unit_price_minor,line_total_minor)
    values (p_tenant_id,v_order.id,v_variant.id,v_product.title,v_variant.sku,v_variant.options,
      v_qty,v_price,v_price*v_qty);
    v_lines := v_lines || jsonb_build_object('title',v_product.title,'options',v_variant.options,
      'quantity',v_qty,'line_total_minor',v_price*v_qty);
  end loop;
  update public.commerce_orders set subtotal_minor=v_subtotal,delivery_minor=v_delivery,
    total_minor=v_subtotal+v_delivery,updated_at=now()
    where id=v_order.id;
  -- Remember the details so the AI doesn't ask again next time.
  if v_customer_id is not null then
    update public.customer_profiles set
      display_name=case when display_name in ('','Customer') then left(trim(p_customer_name),160) else display_name end,
      phone=left(trim(p_customer_phone),40),
      delivery_address=left(trim(p_delivery_address),1000),
      updated_at=now()
    where id=v_customer_id and tenant_id=p_tenant_id;
  end if;
  return jsonb_build_object('order_id',v_order.id,'total_minor',v_subtotal+v_delivery,
    'delivery_minor',v_delivery,'currency',v_currency,'existing',false,'lines',v_lines);
end;
$$;
revoke all on function public.pulse_agent_create_order(uuid,uuid,uuid,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.pulse_agent_create_order(uuid,uuid,uuid,text,text,text,jsonb) to service_role;
