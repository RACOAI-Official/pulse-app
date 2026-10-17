alter table public.conversations add column responder text not null default 'ai'
  check (responder in ('ai', 'human'));
alter table public.messages drop constraint messages_sender_type_check;
alter table public.messages add constraint messages_sender_type_check
  check (sender_type in ('customer', 'human', 'system', 'ai'));

create table public.agent_configs (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  draft jsonb not null default '{"business_name":"","business_description":"","behavior":"","language":"auto","addressing":"neutral","policies":[],"faqs":[],"media_reply":"Thanks for sending that. I am passing it to a team member."}'::jsonb
    check (jsonb_typeof(draft) = 'object'),
  published jsonb check (published is null or jsonb_typeof(published) = 'object'),
  published_version integer not null default 0 check (published_version >= 0),
  enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  published_at timestamptz,
  check (not enabled or published is not null)
);
create policy agent_configs_read on public.agent_configs for select to authenticated
  using (public.pulse_is_member(tenant_id));
create policy agent_configs_insert on public.agent_configs for insert to authenticated
  with check (public.pulse_is_owner(tenant_id));
create policy agent_configs_update on public.agent_configs for update to authenticated
  using (public.pulse_is_owner(tenant_id)) with check (public.pulse_is_owner(tenant_id));
alter table public.agent_configs enable row level security;
revoke all on public.agent_configs from anon, authenticated;
grant select, insert (tenant_id, draft), update (draft) on public.agent_configs to authenticated;

create function public.pulse_publish_agent(p_tenant_id uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_version integer;
begin
  if not public.pulse_is_owner(p_tenant_id) then
    raise exception 'Owner role required' using errcode = '42501';
  end if;
  update public.agent_configs set published = draft,
    published_version = published_version + 1, published_at = now(), updated_at = now()
  where tenant_id = p_tenant_id and length(trim(coalesce(draft->>'business_name',''))) > 0
  returning published_version into v_version;
  if v_version is null then raise exception 'Add a business name before publishing' using errcode = '22023'; end if;
  return v_version;
end;
$$;

create function public.pulse_set_agent_enabled(p_tenant_id uuid, p_enabled boolean)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if not public.pulse_is_owner(p_tenant_id) then
    raise exception 'Owner role required' using errcode = '42501';
  end if;
  update public.agent_configs set enabled = p_enabled, updated_at = now()
  where tenant_id = p_tenant_id and (not p_enabled or published is not null);
  if not found then raise exception 'Publish an agent version first' using errcode = '22023'; end if;
  return p_enabled;
end;
$$;

create function public.pulse_set_responder(p_conversation_id uuid, p_responder text)
returns text language plpgsql security definer set search_path = '' as $$
declare v_tenant_id uuid;
begin
  if p_responder not in ('ai','human') then raise exception 'Invalid responder' using errcode = '22023'; end if;
  select tenant_id into v_tenant_id from public.conversations where id = p_conversation_id;
  if v_tenant_id is null or not public.pulse_is_member(v_tenant_id) then
    raise exception 'Conversation not found' using errcode = '42501';
  end if;
  update public.conversations set responder = p_responder where id = p_conversation_id;
  if p_responder = 'human' then
    update public.agent_jobs set status = 'cancelled'
    where conversation_id = p_conversation_id and status = 'pending';
  end if;
  return p_responder;
end;
$$;

create table public.agent_test_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  prompt text not null check (length(prompt) between 1 and 1000),
  response text not null,
  created_at timestamptz not null default now()
);
create index agent_test_runs_tenant_idx on public.agent_test_runs (tenant_id, user_id, created_at desc);
alter table public.agent_test_runs enable row level security;
create policy agent_test_runs_read on public.agent_test_runs for select to authenticated
  using (public.pulse_is_member(tenant_id) and user_id = (select auth.uid()));
create policy agent_test_runs_insert on public.agent_test_runs for insert to authenticated
  with check (public.pulse_is_member(tenant_id) and user_id = (select auth.uid()));
grant select, insert on public.agent_test_runs to authenticated;

create table public.agent_jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  source_message_id uuid not null unique references public.messages(id) on delete cascade,
  kind text not null check (kind in ('text','media')),
  status text not null default 'pending' check (status in ('pending','processing','done','cancelled','failed')),
  first_at timestamptz not null default now(),
  due_at timestamptz not null default now(),
  claimed_at timestamptz,
  reply_message_id uuid references public.messages(id),
  last_error text,
  created_at timestamptz not null default now()
);
create index agent_jobs_due_idx on public.agent_jobs (status, due_at) where status in ('pending','processing');
alter table public.agent_jobs enable row level security;
revoke all on public.agent_jobs from anon, authenticated;

create function public.pulse_enqueue_agent_job() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_first timestamptz; v_enabled boolean; v_responder text;
begin
  if new.direction <> 'inbound' then return new; end if;
  select c.responder, coalesce(a.enabled,false) into v_responder, v_enabled
  from public.conversations c left join public.agent_configs a on a.tenant_id = c.tenant_id
  where c.id = new.conversation_id;
  if v_responder <> 'ai' or not v_enabled then return new; end if;
  select min(first_at) into v_first from public.agent_jobs
  where conversation_id = new.conversation_id and status = 'pending';
  update public.agent_jobs set status = 'cancelled'
  where conversation_id = new.conversation_id and status = 'pending';
  v_first := coalesce(v_first, new.created_at);
  insert into public.agent_jobs (tenant_id, conversation_id, source_message_id, kind, first_at, due_at)
  values (new.tenant_id, new.conversation_id, new.id,
    case when jsonb_array_length(new.media) > 0 then 'media' else 'text' end,
    v_first, case when jsonb_array_length(new.media) > 0 then now()
      else least(now() + interval '3 seconds', v_first + interval '8 seconds') end);
  return new;
end;
$$;
create trigger enqueue_agent_job after insert on public.messages
for each row execute function public.pulse_enqueue_agent_job();

create function public.pulse_claim_agent_job(p_job_id uuid)
returns public.agent_jobs language plpgsql security definer set search_path = '' as $$
declare v_job public.agent_jobs;
begin
  update public.agent_jobs set status='processing', claimed_at=now()
  where id=p_job_id and status='pending' and due_at<=now()
  returning * into v_job;
  return v_job;
end;
$$;

create function public.pulse_complete_agent_job(p_job_id uuid, p_body text, p_handoff boolean default false)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_job public.agent_jobs; v_conv public.conversations; v_source public.messages; v_reply uuid;
begin
  select * into v_job from public.agent_jobs where id=p_job_id for update;
  if v_job.status='done' then return v_job.reply_message_id; end if;
  if v_job.status<>'processing' then return null; end if;
  select * into v_conv from public.conversations where id=v_job.conversation_id for update;
  select * into v_source from public.messages where id=v_job.source_message_id;
  if v_conv.responder<>'ai' or not exists (
    select 1 from public.agent_configs where tenant_id=v_job.tenant_id and enabled
  ) or exists (
    select 1 from public.messages where conversation_id=v_job.conversation_id
      and direction='inbound' and (created_at,id) > (v_source.created_at,v_source.id)
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

create or replace function public.pulse_create_human_reply(
  p_conversation_id uuid, p_body text, p_idempotency_key uuid
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_conversation public.conversations; v_message_id uuid;
begin
  if p_body is null or length(trim(p_body)) < 1 or length(p_body) > 1000 then
    raise exception 'Reply must contain 1 to 1000 characters';
  end if;
  select * into v_conversation from public.conversations where id = p_conversation_id for update;
  if not found or not public.pulse_is_member(v_conversation.tenant_id) then
    raise exception 'Conversation not found' using errcode = '42501';
  end if;
  if v_conversation.last_inbound_at is null or v_conversation.last_inbound_at < now() - interval '24 hours' then
    raise exception 'Reply window expired' using errcode = '22023';
  end if;
  update public.conversations set responder='human' where id=p_conversation_id;
  update public.agent_jobs set status='cancelled'
    where conversation_id=p_conversation_id and status='pending';
  insert into public.messages (tenant_id,conversation_id,channel,direction,sender_type,
    sender_user_id,body,delivery_state,idempotency_key)
  values (v_conversation.tenant_id,p_conversation_id,v_conversation.channel,'outbound',
    'human',auth.uid(),trim(p_body),'queued',p_idempotency_key)
  on conflict (tenant_id,idempotency_key) where idempotency_key is not null
    do update set idempotency_key=excluded.idempotency_key
  returning id into v_message_id;
  return v_message_id;
end;
$$;

revoke all on function public.pulse_publish_agent(uuid), public.pulse_set_agent_enabled(uuid,boolean),
  public.pulse_set_responder(uuid,text), public.pulse_claim_agent_job(uuid),
  public.pulse_complete_agent_job(uuid,text,boolean) from public,anon,authenticated;
grant execute on function public.pulse_publish_agent(uuid), public.pulse_set_agent_enabled(uuid,boolean),
  public.pulse_set_responder(uuid,text) to authenticated;
grant execute on function public.pulse_claim_agent_job(uuid),
  public.pulse_complete_agent_job(uuid,text,boolean) to service_role;
