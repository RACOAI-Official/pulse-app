create or replace function public.pulse_link_customer(p_tenant_id uuid, p_conversation_id uuid, p_customer_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
begin
  if not public.pulse_is_member(p_tenant_id) then raise exception 'Tenant not found' using errcode='42501'; end if;
  if not exists(select 1 from public.customer_profiles where id=p_customer_id and tenant_id=p_tenant_id) then
    raise exception 'Customer not found' using errcode='22023';
  end if;
  update public.conversations set customer_id=p_customer_id
    where id=p_conversation_id and tenant_id=p_tenant_id;
  if not found then raise exception 'Conversation not found' using errcode='22023'; end if;
  update public.commerce_orders set customer_id=p_customer_id
    where conversation_id=p_conversation_id and tenant_id=p_tenant_id;
  return p_customer_id;
end;
$$;
