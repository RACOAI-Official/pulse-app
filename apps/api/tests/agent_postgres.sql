-- Run with psql -v ON_ERROR_STOP=1 -f apps/api/tests/agent_postgres.sql.
-- All records and state changes are rolled back.
begin;
do $$
declare
  v_tenant uuid; v_connection uuid; v_conversation uuid;
  v_message uuid; v_first_job uuid; v_job public.agent_jobs; v_reply uuid;
begin
  insert into public.tenants (name) values ('Pulse Phase 3 transaction test') returning id into v_tenant;
  insert into public.channel_connections
    (tenant_id,channel,external_account_id,display_name,credential_ciphertext)
  values (v_tenant,'messenger','phase3-'||v_tenant,'Test Page','test-only')
  returning id into v_connection;
  insert into public.agent_configs
    (tenant_id,draft,published,draft_revision,tested_revision,published_version,enabled)
  values (v_tenant,'{"business_name":"Test"}','{"business_name":"Test"}',1,1,1,true);

  v_message := public.pulse_record_inbound(v_connection,'customer','first','Hi','[]');
  select id into v_conversation from public.conversations where connection_id=v_connection;
  select id into v_first_job from public.agent_jobs where source_message_id=v_message;
  if v_first_job is null then raise exception 'First inbound did not enqueue AI'; end if;

  v_message := public.pulse_record_inbound(v_connection,'customer','second','Is XL available?','[]');
  if (select status from public.agent_jobs where id=v_first_job) <> 'cancelled' then
    raise exception 'Fragment was not coalesced';
  end if;
  select * into v_job from public.agent_jobs where source_message_id=v_message;
  if v_job.status <> 'pending' or v_job.first_at > v_job.created_at then
    raise exception 'Coalesced job invalid';
  end if;
  update public.agent_jobs set due_at=now()-interval '1 second' where id=v_job.id;
  select * into v_job from public.pulse_claim_agent_job(v_job.id);
  if v_job.status <> 'processing' then raise exception 'Agent claim failed'; end if;
  v_reply := public.pulse_complete_agent_job(v_job.id,'Please tell me the product.',false);
  if v_reply is null or (select sender_type from public.messages where id=v_reply) <> 'ai' then
    raise exception 'AI reply was not queued';
  end if;
  if public.pulse_complete_agent_job(v_job.id,'Duplicate',false) <> v_reply then
    raise exception 'Completion was not idempotent';
  end if;

  v_message := public.pulse_record_inbound(v_connection,'customer','photo',null,
    '[{"type":"image"}]');
  select * into v_job from public.agent_jobs where source_message_id=v_message;
  select * into v_job from public.pulse_claim_agent_job(v_job.id);
  v_reply := public.pulse_complete_agent_job(v_job.id,'A teammate will help.',true);
  if v_reply is null or (select responder from public.conversations where id=v_conversation) <> 'human' then
    raise exception 'Media did not hand off to a human';
  end if;
  v_message := public.pulse_record_inbound(v_connection,'customer','after-handoff','More text','[]');
  if exists (select 1 from public.agent_jobs where source_message_id=v_message) then
    raise exception 'AI replied during human takeover';
  end if;
end $$;
rollback;
