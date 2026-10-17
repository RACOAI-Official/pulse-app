-- Run with psql -v ON_ERROR_STOP=1 -f apps/api/tests/workspace_postgres.sql.
-- All fixtures and writes roll back.
begin;
select gen_random_uuid() as test_user, gen_random_uuid() as own_tenant,
  gen_random_uuid() as other_tenant \gset
insert into auth.users(id) values (:'test_user');
insert into public.tenants(id,name) values
  (:'own_tenant','Workspace test tenant'),(:'other_tenant','Isolated tenant');
insert into public.memberships(tenant_id,user_id,role)
  values(:'own_tenant',:'test_user','owner');
insert into public.channel_connections(tenant_id,channel,external_account_id,display_name,credential_ciphertext)
  values(:'own_tenant','messenger','workspace-test-'||:'own_tenant','Test Page','test-only');
insert into public.products(tenant_id,handle,title,state)
  values(:'own_tenant','workspace-test-product','Test product','active');
insert into public.product_variants(tenant_id,product_id,sku,regular_price_minor,stock)
  select :'own_tenant',id,'WORKSPACE-TEST-SKU',1000,3 from public.products
  where tenant_id=:'own_tenant' and handle='workspace-test-product';
insert into public.public_comments(tenant_id,connection_id,channel,post_id,provider_comment_id,author_id,body)
  select :'own_tenant',id,'messenger','post-1','comment-1','customer','Price?'
  from public.channel_connections where tenant_id=:'own_tenant';
select public.pulse_record_inbound(id,'customer','message-1','Hello','[]')
  from public.channel_connections where tenant_id=:'own_tenant';
insert into public.messages(tenant_id,conversation_id,channel,direction,sender_type,body,delivery_state)
  select tenant_id,id,channel,'outbound','ai','Pending AI answer','queued'
  from public.conversations where tenant_id=:'own_tenant';
insert into public.messages(tenant_id,conversation_id,channel,direction,sender_type,body,delivery_state)
  select tenant_id,id,channel,'outbound','human','Delivered team answer','sent'
  from public.conversations where tenant_id=:'own_tenant';

set local role authenticated;
select set_config('request.jwt.claim.sub',:'test_user',true);
select set_config('app.test_own_tenant',:'own_tenant',true);
select set_config('app.test_other_tenant',:'other_tenant',true);
do $$
declare v_tenant uuid := current_setting('app.test_own_tenant')::uuid;
  v_other uuid := current_setting('app.test_other_tenant')::uuid;
  v_conversation uuid; v_profile uuid; v_ticket uuid; v_comment uuid;
  v_proposal public.admin_proposals; v_report jsonb;
begin
  select id,customer_id into v_conversation,v_profile from public.conversations
    where tenant_id=v_tenant limit 1;
  if v_profile is null then raise exception 'Conversation did not create CRM profile'; end if;
  v_ticket := public.pulse_create_ticket(v_tenant,v_conversation,'Follow up');
  if public.pulse_set_ticket_status(v_tenant,v_ticket,'resolved')<>'resolved' then
    raise exception 'Ticket resolution failed';
  end if;
  select id into v_comment from public.public_comments where tenant_id=v_tenant;
  perform public.pulse_queue_comment_reply(v_tenant,v_comment,'Public answer');
  if (select reply_status from public.public_comments where id=v_comment)<>'queued' then
    raise exception 'Public reply was not queued';
  end if;
  v_proposal := public.pulse_admin_propose(v_tenant,'Add one unit','adjust_stock',
    '{"sku":"WORKSPACE-TEST-SKU","delta":1}'::jsonb);
  if (v_proposal.after_state->>'stock')::integer<>4 then
    raise exception 'Admin diff incorrect';
  end if;
  v_proposal := public.pulse_admin_decide(v_tenant,v_proposal.id,true);
  if v_proposal.status<>'applied' or
    (select stock from public.product_variants where sku='WORKSPACE-TEST-SKU')<>4 then
    raise exception 'Confirmed admin write failed';
  end if;
  v_report := public.pulse_analytics(v_tenant,7);
  if (v_report->'totals'->>'received')::integer<>1 or
    (v_report->'totals'->>'ai_replies')::integer<>0 or
    (v_report->'totals'->>'human_replies')::integer<>1 or
    (select count(*) from public.usage_events where tenant_id=v_tenant and kind='inbound_message')<>1 then
    raise exception 'Analytics or metering missed inbound message';
  end if;
  begin
    perform public.pulse_create_ticket(v_other,v_conversation,'Leak');
    raise exception 'Cross-tenant ticket write succeeded';
  exception when insufficient_privilege then null;
  end;
end $$;
rollback;
