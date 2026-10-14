create extension if not exists pgcrypto;

create type public.pulse_channel as enum ('messenger', 'instagram', 'whatsapp');
create type public.pulse_role as enum ('owner', 'staff');
create type public.pulse_conversation_state as enum ('open', 'resolved');
create type public.pulse_delivery_state as enum ('queued', 'sending', 'sent', 'failed', 'uncertain');

create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 120),
  created_at timestamptz not null default now()
);

create table public.memberships (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.pulse_role not null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, user_id)
);
create index memberships_user_id_idx on public.memberships (user_id, tenant_id);

create function public.pulse_is_member(p_tenant_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships m
    where m.tenant_id = p_tenant_id and m.user_id = (select auth.uid())
  );
$$;

create function public.pulse_is_owner(p_tenant_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships m
    where m.tenant_id = p_tenant_id and m.user_id = (select auth.uid()) and m.role = 'owner'
  );
$$;

create table public.channel_connections (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  channel public.pulse_channel not null,
  external_account_id text not null,
  display_name text not null,
  credential_ciphertext text not null,
  status text not null default 'connected' check (status in ('connected', 'disconnected')),
  created_at timestamptz not null default now(),
  unique (channel, external_account_id),
  unique (id, tenant_id, channel)
);
create index channel_connections_tenant_idx on public.channel_connections (tenant_id);

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  connection_id uuid not null,
  channel public.pulse_channel not null,
  external_thread_id text not null,
  customer_name text,
  state public.pulse_conversation_state not null default 'open',
  unread_count integer not null default 0 check (unread_count >= 0),
  last_inbound_at timestamptz,
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (connection_id, external_thread_id),
  unique (id, tenant_id, channel),
  foreign key (connection_id, tenant_id, channel)
    references public.channel_connections(id, tenant_id, channel)
);
create index conversations_inbox_idx on public.conversations (tenant_id, last_message_at desc);
create index conversations_state_idx on public.conversations (tenant_id, state, last_message_at desc);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  conversation_id uuid not null,
  channel public.pulse_channel not null,
  direction text not null check (direction in ('inbound', 'outbound')),
  sender_type text not null check (sender_type in ('customer', 'human', 'system')),
  sender_user_id uuid references auth.users(id),
  provider_id text,
  idempotency_key uuid,
  body text,
  media jsonb not null default '[]'::jsonb check (jsonb_typeof(media) = 'array'),
  delivery_state public.pulse_delivery_state,
  failure_reason text,
  sent_at timestamptz,
  sending_at timestamptz,
  created_at timestamptz not null default now(),
  check (body is not null or jsonb_array_length(media) > 0),
  check ((direction = 'outbound' and delivery_state is not null) or
         (direction = 'inbound' and delivery_state is null)),
  foreign key (conversation_id, tenant_id, channel)
    references public.conversations(id, tenant_id, channel) on delete cascade
);
create unique index messages_provider_unique on public.messages (tenant_id, channel, provider_id) where provider_id is not null;
create unique index messages_idempotency_unique on public.messages (tenant_id, idempotency_key) where idempotency_key is not null;
create index messages_thread_idx on public.messages (conversation_id, created_at, id);
create index messages_send_idx on public.messages (delivery_state, created_at) where direction = 'outbound';

create table public.webhook_events (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  channel public.pulse_channel not null,
  external_event_id text not null,
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'processing', 'done', 'failed')),
  attempts integer not null default 0,
  claimed_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (connection_id, external_event_id),
  foreign key (connection_id, tenant_id, channel)
    references public.channel_connections(id, tenant_id, channel)
);
create index webhook_events_pending_idx on public.webhook_events (status, created_at)
  where status in ('pending', 'processing');

create function public.pulse_message_rollup() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.direction = 'inbound' then
    update public.conversations set
      last_message_at = greatest(last_message_at, new.created_at),
      last_inbound_at = greatest(coalesce(last_inbound_at, new.created_at), new.created_at),
      unread_count = unread_count + 1,
      state = 'open'
    where id = new.conversation_id;
  else
    update public.conversations set last_message_at = greatest(last_message_at, new.created_at)
    where id = new.conversation_id;
  end if;
  return new;
end;
$$;
create trigger message_rollup after insert on public.messages
for each row execute function public.pulse_message_rollup();

create function public.pulse_create_human_reply(
  p_conversation_id uuid, p_body text, p_idempotency_key uuid
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_conversation public.conversations; v_message_id uuid;
begin
  if p_body is null or length(trim(p_body)) < 1 or length(p_body) > 1000 then
    raise exception 'Reply must contain 1 to 1000 characters';
  end if;
  select * into v_conversation from public.conversations where id = p_conversation_id;
  if not found or not public.pulse_is_member(v_conversation.tenant_id) then
    raise exception 'Conversation not found' using errcode = '42501';
  end if;
  if v_conversation.last_inbound_at is null or v_conversation.last_inbound_at < now() - interval '24 hours' then
    raise exception 'Reply window expired' using errcode = '22023';
  end if;
  insert into public.messages (
    tenant_id, conversation_id, channel, direction, sender_type, sender_user_id,
    body, delivery_state, idempotency_key
  ) values (
    v_conversation.tenant_id, p_conversation_id, v_conversation.channel, 'outbound',
    'human', auth.uid(), trim(p_body), 'queued', p_idempotency_key
  ) on conflict (tenant_id, idempotency_key) where idempotency_key is not null
    do update set idempotency_key = excluded.idempotency_key
  returning id into v_message_id;
  return v_message_id;
end;
$$;

create function public.pulse_claim_outbound(p_message_id uuid)
returns public.messages language plpgsql security definer set search_path = '' as $$
declare v_message public.messages;
begin
  update public.messages set delivery_state = 'sending', sending_at = now()
  where id = p_message_id and delivery_state = 'queued'
  returning * into v_message;
  return v_message;
end;
$$;

create function public.pulse_claim_webhook(p_event_id uuid)
returns public.webhook_events language plpgsql security definer set search_path = '' as $$
declare v_event public.webhook_events;
begin
  update public.webhook_events set status = 'processing', attempts = attempts + 1,
    claimed_at = now()
  where id = p_event_id and (status = 'pending' or
    (status = 'processing' and claimed_at < now() - interval '5 minutes'))
  returning * into v_event;
  return v_event;
end;
$$;

create function public.pulse_record_inbound(
  p_connection_id uuid, p_thread_id text, p_provider_id text,
  p_body text, p_media jsonb default '[]'::jsonb, p_customer_name text default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_connection public.channel_connections; v_conversation_id uuid; v_message_id uuid;
begin
  select * into v_connection from public.channel_connections
    where id = p_connection_id and status = 'connected';
  if not found then raise exception 'Channel connection unavailable'; end if;
  if p_thread_id is null or p_provider_id is null or
     (nullif(trim(coalesce(p_body, '')), '') is null and jsonb_array_length(p_media) = 0) then
    raise exception 'Invalid inbound message';
  end if;
  insert into public.conversations (
    tenant_id, connection_id, channel, external_thread_id, customer_name
  ) values (
    v_connection.tenant_id, v_connection.id, v_connection.channel, p_thread_id, p_customer_name
  ) on conflict (connection_id, external_thread_id) do update
    set customer_name = coalesce(excluded.customer_name, public.conversations.customer_name)
  returning id into v_conversation_id;
  insert into public.messages (
    tenant_id, conversation_id, channel, direction, sender_type, provider_id, body, media
  ) values (
    v_connection.tenant_id, v_conversation_id, v_connection.channel, 'inbound', 'customer',
    p_provider_id, nullif(trim(coalesce(p_body, '')), ''), p_media
  ) on conflict (tenant_id, channel, provider_id) where provider_id is not null do nothing
  returning id into v_message_id;
  return v_message_id;
end;
$$;

create function public.pulse_search_conversations(
  p_tenant_id uuid, p_query text default '', p_channel public.pulse_channel default null,
  p_state public.pulse_conversation_state default null
) returns setof public.conversations language sql stable security invoker set search_path = '' as $$
  select c.* from public.conversations c
  where c.tenant_id = p_tenant_id
    and (p_channel is null or c.channel = p_channel)
    and (p_state is null or c.state = p_state)
    and (p_query = '' or c.customer_name ilike '%' || p_query || '%'
      or c.external_thread_id ilike '%' || p_query || '%'
      or exists (select 1 from public.messages m where m.conversation_id = c.id
        and m.body ilike '%' || p_query || '%'))
  order by c.last_message_at desc limit 100;
$$;

alter table public.tenants enable row level security;
alter table public.memberships enable row level security;
alter table public.channel_connections enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.webhook_events enable row level security;

create policy tenants_read on public.tenants for select to authenticated
  using (public.pulse_is_member(id));
create policy memberships_read on public.memberships for select to authenticated
  using (public.pulse_is_member(tenant_id));
create policy conversations_read on public.conversations for select to authenticated
  using (public.pulse_is_member(tenant_id));
create policy conversations_update on public.conversations for update to authenticated
  using (public.pulse_is_member(tenant_id)) with check (public.pulse_is_member(tenant_id));
create policy messages_read on public.messages for select to authenticated
  using (public.pulse_is_member(tenant_id));

grant select on public.tenants, public.memberships to authenticated;
revoke all on public.channel_connections, public.webhook_events from anon, authenticated;
revoke all on public.messages from anon, authenticated;
grant select on public.messages to authenticated;
revoke all on public.conversations from anon, authenticated;
grant select on public.conversations to authenticated;
grant update (state, unread_count) on public.conversations to authenticated;
revoke all on function public.pulse_claim_outbound(uuid), public.pulse_claim_webhook(uuid),
  public.pulse_record_inbound(uuid, text, text, text, jsonb, text) from public, anon, authenticated;
revoke all on function public.pulse_create_human_reply(uuid, text, uuid) from public, anon;
grant execute on function public.pulse_create_human_reply(uuid, text, uuid) to authenticated;
grant execute on function public.pulse_search_conversations(uuid, text, public.pulse_channel,
  public.pulse_conversation_state) to authenticated;
grant execute on function public.pulse_claim_outbound(uuid), public.pulse_claim_webhook(uuid),
  public.pulse_record_inbound(uuid, text, text, text, jsonb, text) to service_role;

insert into storage.buckets (id, name, public) values ('inbox-media', 'inbox-media', false)
on conflict (id) do nothing;
