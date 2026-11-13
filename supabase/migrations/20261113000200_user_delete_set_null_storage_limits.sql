-- Deleting an auth user keeps business history: actor/creator links become NULL instead of
-- blocking the delete (memberships and platform_operators still cascade).
-- Storage buckets get the same size and type limits the API already enforces.

alter table public.commerce_payments alter column actor_user_id drop not null;
alter table public.agent_test_runs alter column user_id drop not null;
alter table public.admin_proposals alter column actor_user_id drop not null;

alter table public.messages drop constraint messages_sender_user_id_fkey,
  add constraint messages_sender_user_id_fkey foreign key (sender_user_id) references auth.users(id) on delete set null;
alter table public.stock_movements drop constraint stock_movements_actor_user_id_fkey,
  add constraint stock_movements_actor_user_id_fkey foreign key (actor_user_id) references auth.users(id) on delete set null;
alter table public.commerce_orders drop constraint commerce_orders_created_by_fkey,
  add constraint commerce_orders_created_by_fkey foreign key (created_by) references auth.users(id) on delete set null;
alter table public.commerce_payments drop constraint commerce_payments_actor_user_id_fkey,
  add constraint commerce_payments_actor_user_id_fkey foreign key (actor_user_id) references auth.users(id) on delete set null;
alter table public.agent_test_runs drop constraint agent_test_runs_user_id_fkey,
  add constraint agent_test_runs_user_id_fkey foreign key (user_id) references auth.users(id) on delete set null;
alter table public.agent_versions drop constraint agent_versions_published_by_fkey,
  add constraint agent_versions_published_by_fkey foreign key (published_by) references auth.users(id) on delete set null;
alter table public.support_tickets drop constraint support_tickets_created_by_fkey,
  add constraint support_tickets_created_by_fkey foreign key (created_by) references auth.users(id) on delete set null;
alter table public.admin_proposals drop constraint admin_proposals_actor_user_id_fkey,
  add constraint admin_proposals_actor_user_id_fkey foreign key (actor_user_id) references auth.users(id) on delete set null;

-- A proposal whose author was deleted (actor NULL) must not be decidable by anyone else.
create or replace function public.pulse_admin_decide(p_tenant_id uuid, p_proposal_id uuid, p_confirm boolean)
returns public.admin_proposals language plpgsql security definer set search_path = '' as $$
declare v public.admin_proposals; v_variant public.product_variants; v_agent public.agent_configs;
  v_product_id uuid; v_handle text; v_existing integer;
begin
  select * into v from public.admin_proposals
    where id=p_proposal_id and tenant_id=p_tenant_id for update;
  if not found or v.actor_user_id is distinct from auth.uid() or not public.pulse_admin_allowed(p_tenant_id,v.action='add_faq') then
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

-- Storage: limits mirror the API (commerce.py upload_media: 15 MB JPEG/PNG/WebP;
-- media.py save_media: 20 MB Meta attachments; octet-stream is the API's fallback type).
update storage.buckets set file_size_limit = 15728640,
  allowed_mime_types = array['image/jpeg','image/png','image/webp']
  where id = 'catalog-media';
update storage.buckets set file_size_limit = 20971520,
  allowed_mime_types = array['image/*','video/*','audio/*','application/pdf','text/plain',
    'application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/octet-stream']
  where id = 'inbox-media';
