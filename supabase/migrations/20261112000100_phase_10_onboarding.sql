-- Phase 10: owner onboarding wizard, delivery settings, checkout return path, OAuth channel metadata.

-- Existing workspaces are treated as already onboarded; only new sign-ups enter the wizard.
alter table public.tenants
  add column if not exists onboarding_step text not null default 'done',
  add column if not exists onboarding_completed_at timestamptz default now();
alter table public.tenants
  alter column onboarding_step set default 'business',
  alter column onboarding_completed_at drop default;
alter table public.tenants drop constraint if exists tenants_onboarding_step_check;
alter table public.tenants add constraint tenants_onboarding_step_check
  check (onboarding_step in ('business','ai','delivery','plan','integrations','inbox','done'));

create table if not exists public.delivery_settings (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  inside_dhaka_fee_minor integer not null default 0 check (inside_dhaka_fee_minor >= 0),
  outside_dhaka_fee_minor integer not null default 0 check (outside_dhaka_fee_minor >= 0),
  inside_dhaka_days integer not null default 1 check (inside_dhaka_days between 0 and 60),
  outside_dhaka_days integer not null default 3 check (outside_dhaka_days between 0 and 60),
  cod_enabled boolean not null default true,
  free_delivery_threshold_minor integer check (free_delivery_threshold_minor is null or free_delivery_threshold_minor >= 0),
  notes text not null default '' check (length(notes) <= 1000),
  updated_at timestamptz not null default now()
);
alter table public.delivery_settings enable row level security;
drop policy if exists delivery_settings_read on public.delivery_settings;
create policy delivery_settings_read on public.delivery_settings for select to authenticated
  using ((select public.pulse_is_member(tenant_id)));
revoke all on public.delivery_settings from anon, authenticated;
grant select on public.delivery_settings to authenticated;

alter table public.billing_checkouts
  add column if not exists return_path text not null default '/plan';
alter table public.billing_checkouts drop constraint if exists billing_checkouts_return_path_check;
alter table public.billing_checkouts add constraint billing_checkouts_return_path_check
  check (return_path in ('/plan','/onboarding'));

alter table public.channel_connections
  add column if not exists token_expires_at timestamptz,
  add column if not exists connected_via text not null default 'operator';
alter table public.channel_connections drop constraint if exists channel_connections_connected_via_check;
alter table public.channel_connections add constraint channel_connections_connected_via_check
  check (connected_via in ('operator','oauth'));
create index if not exists channel_connections_token_expiry_idx
  on public.channel_connections (token_expires_at) where token_expires_at is not null and status = 'connected';

-- Re-price a fresh AI draft order with the owner's delivery zone fee (inside/outside Dhaka).
-- Without delivery settings the per-product fee from pulse_agent_create_order stays.
create or replace function public.pulse_agent_apply_delivery_zone(
  p_tenant_id uuid, p_order_id uuid, p_zone text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_settings public.delivery_settings; v_order public.commerce_orders; v_fee bigint;
begin
  if p_zone not in ('inside_dhaka','outside_dhaka') then
    raise exception 'Invalid delivery zone' using errcode='22023';
  end if;
  select * into v_order from public.commerce_orders
    where id=p_order_id and tenant_id=p_tenant_id and source='agent' for update;
  if not found then raise exception 'Order not found' using errcode='22023'; end if;
  select * into v_settings from public.delivery_settings where tenant_id=p_tenant_id;
  if not found then
    return jsonb_build_object('delivery_minor',v_order.delivery_minor,'total_minor',v_order.total_minor);
  end if;
  v_fee := case when p_zone='inside_dhaka' then v_settings.inside_dhaka_fee_minor
                else v_settings.outside_dhaka_fee_minor end;
  if v_settings.free_delivery_threshold_minor is not null
     and v_order.subtotal_minor >= v_settings.free_delivery_threshold_minor then
    v_fee := 0;
  end if;
  update public.commerce_orders set delivery_minor=v_fee, total_minor=subtotal_minor+v_fee, updated_at=now()
    where id=v_order.id;
  return jsonb_build_object('delivery_minor',v_fee,'total_minor',v_order.subtotal_minor+v_fee);
end;
$$;
revoke all on function public.pulse_agent_apply_delivery_zone(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.pulse_agent_apply_delivery_zone(uuid,uuid,text) to service_role;
