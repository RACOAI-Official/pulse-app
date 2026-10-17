alter table public.conversations add constraint conversations_id_tenant_unique unique (id, tenant_id);

create table public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  conversation_id uuid not null,
  subject text not null check (length(trim(subject)) between 1 and 160),
  source text not null check (source in ('staff', 'agent_handoff')),
  status text not null default 'active' check (status in ('active', 'resolved')),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  foreign key (conversation_id, tenant_id) references public.conversations(id, tenant_id)
);
create index support_tickets_tenant_idx on public.support_tickets (tenant_id, status, created_at desc);
create unique index support_tickets_one_active on public.support_tickets (conversation_id) where status = 'active';

create table public.public_comments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  connection_id uuid not null,
  channel public.pulse_channel not null check (channel in ('messenger', 'instagram')),
  post_id text not null,
  provider_comment_id text not null,
  parent_comment_id text,
  author_id text not null default '',
  author_name text not null default '',
  body text not null default '',
  provider_created_at timestamptz,
  reply_body text,
  reply_provider_id text,
  reply_status text check (reply_status in ('queued', 'sending', 'sent', 'failed', 'uncertain')),
  failure_reason text,
  created_at timestamptz not null default now(),
  unique (connection_id, provider_comment_id),
  foreign key (connection_id, tenant_id, channel)
    references public.channel_connections(id, tenant_id, channel)
);
create index public_comments_tenant_idx on public.public_comments (tenant_id, created_at desc);

create function public.pulse_create_ticket(p_tenant_id uuid, p_conversation_id uuid, p_subject text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not public.pulse_is_member(p_tenant_id) then raise exception 'Tenant not found' using errcode='42501'; end if;
  if not exists (select 1 from public.conversations where id=p_conversation_id and tenant_id=p_tenant_id) then
    raise exception 'Conversation not found' using errcode='22023';
  end if;
  if length(trim(p_subject)) not between 1 and 160 then raise exception 'Invalid subject' using errcode='22023'; end if;
  insert into public.support_tickets(tenant_id, conversation_id, subject, source, created_by)
  values(p_tenant_id, p_conversation_id, trim(p_subject), 'staff', auth.uid()) returning id into v_id;
  return v_id;
end;
$$;

create function public.pulse_set_ticket_status(p_tenant_id uuid, p_ticket_id uuid, p_status text)
returns text language plpgsql security definer set search_path = '' as $$
begin
  if not public.pulse_is_member(p_tenant_id) then raise exception 'Tenant not found' using errcode='42501'; end if;
  if p_status not in ('active', 'resolved') then raise exception 'Invalid status' using errcode='22023'; end if;
  update public.support_tickets set status=p_status,
    resolved_at=case when p_status='resolved' then now() else null end
  where id=p_ticket_id and tenant_id=p_tenant_id;
  if not found then raise exception 'Ticket not found' using errcode='22023'; end if;
  return p_status;
end;
$$;

create function public.pulse_queue_comment_reply(p_tenant_id uuid, p_comment_id uuid, p_body text)
returns uuid language plpgsql security definer set search_path = '' as $$
begin
  if not public.pulse_is_member(p_tenant_id) then raise exception 'Tenant not found' using errcode='42501'; end if;
  if length(trim(p_body)) not between 1 and 1000 then raise exception 'Invalid reply' using errcode='22023'; end if;
  update public.public_comments set reply_body=trim(p_body), reply_status='queued', failure_reason=null
  where id=p_comment_id and tenant_id=p_tenant_id and reply_status is null;
  if not found then raise exception 'Comment already replied to or unavailable' using errcode='22023'; end if;
  return p_comment_id;
end;
$$;

alter table public.support_tickets enable row level security;
alter table public.public_comments enable row level security;
create policy support_tickets_read on public.support_tickets for select to authenticated
  using (public.pulse_is_member(tenant_id));
create policy public_comments_read on public.public_comments for select to authenticated
  using (public.pulse_is_member(tenant_id));
grant select on public.support_tickets, public.public_comments to authenticated;
revoke all on public.support_tickets, public.public_comments from anon;
revoke all on function public.pulse_create_ticket(uuid,uuid,text),
  public.pulse_set_ticket_status(uuid,uuid,text),
  public.pulse_queue_comment_reply(uuid,uuid,text) from public,anon;
grant execute on function public.pulse_create_ticket(uuid,uuid,text),
  public.pulse_set_ticket_status(uuid,uuid,text),
  public.pulse_queue_comment_reply(uuid,uuid,text) to authenticated;

create function public.pulse_unreplied_conversations(p_tenant_id uuid)
returns setof public.conversations language sql stable security definer set search_path = '' as $$
  select c.* from public.conversations c
  where c.tenant_id = p_tenant_id and public.pulse_is_member(p_tenant_id)
    and c.last_inbound_at is not null
    and not exists (select 1 from public.messages m
      where m.conversation_id = c.id and m.direction = 'outbound'
        and m.created_at >= c.last_inbound_at and m.delivery_state <> 'failed')
  order by c.last_inbound_at desc limit 200;
$$;
revoke all on function public.pulse_unreplied_conversations(uuid) from public,anon;
grant execute on function public.pulse_unreplied_conversations(uuid) to authenticated;
