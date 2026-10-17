alter table public.agent_jobs add column job_seq bigint generated always as identity unique;

create or replace function public.pulse_complete_agent_job(p_job_id uuid, p_body text, p_handoff boolean default false)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_job public.agent_jobs; v_conv public.conversations; v_reply uuid;
begin
  select * into v_job from public.agent_jobs where id=p_job_id for update;
  if v_job.status='done' then return v_job.reply_message_id; end if;
  if v_job.status<>'processing' then return null; end if;
  select * into v_conv from public.conversations where id=v_job.conversation_id for update;
  if v_conv.responder<>'ai' or not exists (
    select 1 from public.agent_configs where tenant_id=v_job.tenant_id and enabled
  ) or exists (
    select 1 from public.agent_jobs where conversation_id=v_job.conversation_id
      and job_seq > v_job.job_seq
  ) then
    update public.agent_jobs set status='cancelled' where id=p_job_id;
    return null;
  end if;
  if p_body is null or length(trim(p_body))=0 or length(p_body)>1000 then
    raise exception 'Invalid agent reply' using errcode='22023';
  end if;
  if p_handoff then update public.conversations set responder='human' where id=v_conv.id; end if;
  insert into public.messages (tenant_id, conversation_id, channel, direction, sender_type,
    body, delivery_state)
  values (v_job.tenant_id, v_job.conversation_id, v_conv.channel, 'outbound',
    case when p_handoff then 'system' else 'ai' end, trim(p_body), 'queued')
  returning id into v_reply;
  update public.agent_jobs set status='done', reply_message_id=v_reply where id=p_job_id;
  return v_reply;
end;
$$;
