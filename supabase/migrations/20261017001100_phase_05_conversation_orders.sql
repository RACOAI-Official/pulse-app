alter table public.commerce_orders add column conversation_id uuid;
alter table public.commerce_orders add column customer_id uuid;
alter table public.commerce_orders add constraint orders_conversation_fk
  foreign key (conversation_id, tenant_id) references public.conversations(id, tenant_id);
alter table public.commerce_orders add constraint orders_customer_fk
  foreign key (customer_id, tenant_id) references public.customer_profiles(id, tenant_id);
create index orders_conversation_idx on public.commerce_orders (conversation_id, created_at desc);
create index orders_customer_idx on public.commerce_orders (customer_id, created_at desc);

create function public.pulse_attach_order_to_conversation(p_tenant_id uuid,
  p_order_id uuid, p_conversation_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_customer_id uuid;
begin
  if not public.pulse_is_member(p_tenant_id) then raise exception 'Tenant not found' using errcode='42501'; end if;
  select customer_id into v_customer_id from public.conversations
    where id=p_conversation_id and tenant_id=p_tenant_id;
  if not found then raise exception 'Conversation not found' using errcode='22023'; end if;
  update public.commerce_orders set conversation_id=p_conversation_id,
    customer_id=v_customer_id,updated_at=now()
    where id=p_order_id and tenant_id=p_tenant_id and state in ('draft','pending_confirmation');
  if not found then raise exception 'Editable order not found' using errcode='22023'; end if;
  return p_order_id;
end;
$$;
revoke all on function public.pulse_attach_order_to_conversation(uuid,uuid,uuid) from public,anon;
grant execute on function public.pulse_attach_order_to_conversation(uuid,uuid,uuid) to authenticated;
