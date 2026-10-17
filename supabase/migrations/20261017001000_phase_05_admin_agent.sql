create table public.admin_proposals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  actor_user_id uuid not null references auth.users(id),
  prompt text not null,
  action text not null check (action in ('adjust_stock','set_price','create_product','add_faq')),
  payload jsonb not null,
  before_state jsonb not null default '{}'::jsonb,
  after_state jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending','applied','rejected')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '15 minutes',
  applied_at timestamptz
);
create index admin_proposals_actor_idx on public.admin_proposals (tenant_id, actor_user_id, created_at desc);
alter table public.admin_proposals enable row level security;
create policy admin_proposals_read on public.admin_proposals for select to authenticated
  using (actor_user_id = auth.uid() and public.pulse_is_member(tenant_id));
grant select on public.admin_proposals to authenticated;
revoke all on public.admin_proposals from anon;

create function public.pulse_admin_allowed(p_tenant_id uuid, p_owner_only boolean default false)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.memberships
    where tenant_id=p_tenant_id and user_id=auth.uid()
      and (role='owner' or (not p_owner_only and role='manager')));
$$;

create function public.pulse_admin_propose(p_tenant_id uuid, p_prompt text, p_action text, p_payload jsonb)
returns public.admin_proposals language plpgsql security definer set search_path = '' as $$
declare v_variant public.product_variants; v_product public.products; v_agent public.agent_configs;
  v_before jsonb; v_after jsonb; v_result public.admin_proposals; v_delta integer; v_price bigint;
begin
  if not public.pulse_admin_allowed(p_tenant_id, p_action='add_faq') then
    raise exception 'Admin Agent access required' using errcode='42501';
  end if;
  if length(trim(p_prompt)) not between 1 and 1000 or
     p_action not in ('adjust_stock','set_price','create_product','add_faq') then
    raise exception 'Unsupported request' using errcode='22023';
  end if;
  if p_action in ('adjust_stock','set_price') then
    select * into v_variant from public.product_variants
      where tenant_id=p_tenant_id and sku=p_payload->>'sku' and active=true;
    if not found then raise exception 'Exact active SKU not found' using errcode='22023'; end if;
    select * into v_product from public.products where id=v_variant.product_id and tenant_id=p_tenant_id;
    if v_product.source_provider <> 'local' then raise exception 'Externally managed product' using errcode='22023'; end if;
    if p_action='adjust_stock' then
      v_delta := (p_payload->>'delta')::integer;
      if v_delta=0 or abs(v_delta)>100000 or v_variant.stock+v_delta<0 then
        raise exception 'Invalid stock adjustment' using errcode='22023';
      end if;
      v_before := jsonb_build_object('sku',v_variant.sku,'stock',v_variant.stock);
      v_after := jsonb_build_object('sku',v_variant.sku,'stock',v_variant.stock+v_delta);
    else
      v_price := (p_payload->>'price_minor')::bigint;
      if v_price<0 or v_price>9000000000000 then raise exception 'Invalid price' using errcode='22023'; end if;
      v_before := jsonb_build_object('sku',v_variant.sku,'regular_price_minor',v_variant.regular_price_minor,
        'offer_price_minor',v_variant.offer_price_minor);
      v_after := jsonb_build_object('sku',v_variant.sku,'regular_price_minor',v_price,'offer_price_minor',null);
    end if;
    p_payload := p_payload || jsonb_build_object('variant_id',v_variant.id);
  elsif p_action='create_product' then
    if length(trim(p_payload->>'title')) not between 1 and 160 or
       length(trim(p_payload->>'sku')) not between 1 and 80 or
       (p_payload->>'price_minor')::bigint < 0 or
       (p_payload->>'stock')::integer < 0 then
      raise exception 'Invalid product draft' using errcode='22023';
    end if;
    v_before := '{}'::jsonb;
    v_after := jsonb_build_object('title',p_payload->>'title','sku',p_payload->>'sku',
      'price_minor',(p_payload->>'price_minor')::bigint,'stock',(p_payload->>'stock')::integer,
      'state','draft');
  else
    select * into v_agent from public.agent_configs where tenant_id=p_tenant_id;
    if not found then raise exception 'Save Agent Studio draft first' using errcode='22023'; end if;
    if length(trim(p_payload->>'question')) not between 1 and 200 or
       length(trim(p_payload->>'answer')) not between 1 and 1000 or
       jsonb_array_length(coalesce(v_agent.draft->'faqs','[]'::jsonb)) >= 100 then
      raise exception 'Invalid FAQ' using errcode='22023';
    end if;
    v_before := jsonb_build_object('draft_revision',v_agent.draft_revision,
      'faq_count',jsonb_array_length(coalesce(v_agent.draft->'faqs','[]'::jsonb)));
    v_after := jsonb_build_object('draft_revision',v_agent.draft_revision+1,
      'add_faq',jsonb_build_object('question',p_payload->>'question','answer',p_payload->>'answer'));
  end if;
  insert into public.admin_proposals(tenant_id,actor_user_id,prompt,action,payload,before_state,after_state)
    values(p_tenant_id,auth.uid(),trim(p_prompt),p_action,p_payload,v_before,v_after)
    returning * into v_result;
  return v_result;
end;
$$;

create function public.pulse_admin_decide(p_tenant_id uuid, p_proposal_id uuid, p_confirm boolean)
returns public.admin_proposals language plpgsql security definer set search_path = '' as $$
declare v public.admin_proposals; v_variant public.product_variants; v_agent public.agent_configs;
  v_product_id uuid; v_handle text; v_existing integer;
begin
  select * into v from public.admin_proposals
    where id=p_proposal_id and tenant_id=p_tenant_id for update;
  if not found or v.actor_user_id<>auth.uid() or not public.pulse_admin_allowed(p_tenant_id,v.action='add_faq') then
    raise exception 'Proposal not found' using errcode='42501';
  end if;
  if v.status<>'pending' or v.expires_at<now() then raise exception 'Proposal expired or completed' using errcode='22023'; end if;
  if not p_confirm then
    update public.admin_proposals set status='rejected' where id=v.id returning * into v;
    return v;
  end if;
  if v.action in ('adjust_stock','set_price') then
    select * into v_variant from public.product_variants
      where id=(v.payload->>'variant_id')::uuid and tenant_id=p_tenant_id for update;
    if not found or not v_variant.active or v_variant.sku<>v.payload->>'sku' then
      raise exception 'Product changed; review a new proposal' using errcode='22023';
    end if;
    if v.action='adjust_stock' then
      if v_variant.stock<>(v.before_state->>'stock')::integer then
        raise exception 'Stock changed; review a new proposal' using errcode='22023';
      end if;
      update public.product_variants set stock=stock+(v.payload->>'delta')::integer,updated_at=now()
        where id=v_variant.id;
      insert into public.stock_movements(tenant_id,variant_id,delta,reason,actor_user_id)
        values(p_tenant_id,v_variant.id,(v.payload->>'delta')::integer,'Admin Agent confirmed change',auth.uid());
    else
      if v_variant.regular_price_minor<>(v.before_state->>'regular_price_minor')::bigint or
         v_variant.offer_price_minor is distinct from (v.before_state->>'offer_price_minor')::bigint then
        raise exception 'Price changed; review a new proposal' using errcode='22023';
      end if;
      update public.product_variants set regular_price_minor=(v.payload->>'price_minor')::bigint,
        offer_price_minor=null,updated_at=now() where id=v_variant.id;
    end if;
  elsif v.action='create_product' then
    v_handle := lower(regexp_replace(v.payload->>'title','[^a-zA-Z0-9]+','-','g'));
    v_handle := trim(both '-' from v_handle);
    if v_handle='' then v_handle:='product'; end if;
    v_handle := left(v_handle,55)||'-'||left(replace(v.id::text,'-',''),8);
    v_product_id := public.pulse_save_product(p_tenant_id,null,v_handle,v.payload->>'title',
      coalesce(v.payload->>'category',''),coalesce(v.payload->>'description',''),
      '[]'::jsonb,null,'draft'::public.pulse_product_state,
      jsonb_build_array(jsonb_build_object('sku',v.payload->>'sku','options','{}'::jsonb,
        'regular_price_minor',(v.payload->>'price_minor')::bigint,'stock',(v.payload->>'stock')::integer)));
    v.after_state := v.after_state || jsonb_build_object('product_id',v_product_id);
  else
    select * into v_agent from public.agent_configs where tenant_id=p_tenant_id for update;
    if not found or v_agent.draft_revision<>(v.before_state->>'draft_revision')::integer then
      raise exception 'Agent draft changed; review a new proposal' using errcode='22023';
    end if;
    perform public.pulse_save_agent_draft(p_tenant_id,
      jsonb_set(v_agent.draft,'{faqs}',coalesce(v_agent.draft->'faqs','[]'::jsonb) ||
        jsonb_build_array(jsonb_build_object('question',v.payload->>'question',
          'answer',v.payload->>'answer'))));
  end if;
  update public.admin_proposals set status='applied',applied_at=now(),after_state=v.after_state
    where id=v.id returning * into v;
  insert into public.activity_events(tenant_id,actor_user_id,action,subject_type,subject_id,details)
    values(p_tenant_id,auth.uid(),'admin_agent_'||v.action,'admin_proposals',v.id,
      jsonb_build_object('prompt',v.prompt,'before',v.before_state,'after',v.after_state));
  return v;
end;
$$;
revoke all on function public.pulse_admin_allowed(uuid,boolean),
  public.pulse_admin_propose(uuid,text,text,jsonb),
  public.pulse_admin_decide(uuid,uuid,boolean) from public,anon;
grant execute on function public.pulse_admin_allowed(uuid,boolean),
  public.pulse_admin_propose(uuid,text,text,jsonb),
  public.pulse_admin_decide(uuid,uuid,boolean) to authenticated;
