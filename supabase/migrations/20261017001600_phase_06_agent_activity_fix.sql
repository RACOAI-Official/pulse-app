create or replace function public.pulse_record_activity() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_tenant uuid; v_id uuid; v_action text;
begin
  v_tenant := case when tg_op='DELETE' then old.tenant_id else new.tenant_id end;
  if tg_table_name='agent_configs' then
    v_id := v_tenant;
  elsif tg_op='DELETE' then
    v_id := old.id;
  else
    v_id := new.id;
  end if;
  v_action := lower(tg_op);
  insert into public.activity_events(tenant_id,actor_user_id,action,subject_type,subject_id)
    values(v_tenant,auth.uid(),v_action,tg_table_name,v_id);
  return coalesce(new,old);
end;
$$;
