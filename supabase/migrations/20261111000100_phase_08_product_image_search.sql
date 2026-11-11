-- Visual product search: one image fingerprint (Unicom ViT-B/32, 512 dims) per product photo.
create extension if not exists vector with schema extensions;

create table public.product_image_embeddings (
  product_id uuid not null references public.products(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  media_key text not null,
  model text not null,
  embedding extensions.vector(512) not null,
  created_at timestamptz not null default now(),
  primary key (product_id, media_key)
);
create index product_image_embeddings_tenant_idx on public.product_image_embeddings (tenant_id);
alter table public.product_image_embeddings enable row level security;
revoke all on public.product_image_embeddings from anon, authenticated;
grant all on public.product_image_embeddings to service_role;

-- Closest active products to a customer photo, best photo per product, highest similarity first.
create function public.pulse_match_product_images(p_tenant_id uuid, p_embedding text, p_model text, p_limit integer default 3)
returns table (product_id uuid, similarity double precision)
language sql stable security definer set search_path = '' as $$
  select e.product_id,
         max(1 - (e.embedding operator(extensions.<=>) p_embedding::extensions.vector(512))) as similarity
  from public.product_image_embeddings e
  join public.products p on p.id = e.product_id and p.state = 'active'
  where e.tenant_id = p_tenant_id and e.model = p_model
  group by e.product_id
  order by similarity desc
  limit least(greatest(p_limit, 1), 10);
$$;

-- Products whose photos are not all fingerprinted yet (new uploads, CSV imports, model change).
create function public.pulse_products_needing_embeddings(p_model text, p_limit integer default 25)
returns table (product_id uuid)
language sql stable security definer set search_path = '' as $$
  select p.id from public.products p
  where p.state in ('active', 'draft') and exists (
    select 1 from jsonb_array_elements(p.media) m
    where not exists (
      select 1 from public.product_image_embeddings e
      where e.product_id = p.id and e.model = p_model
        and e.media_key = coalesce(m->>'path', m->>'url')))
  order by p.updated_at desc
  limit least(greatest(p_limit, 1), 100);
$$;

revoke all on function public.pulse_match_product_images(uuid,text,text,integer),
  public.pulse_products_needing_embeddings(text,integer) from public, anon, authenticated;
grant execute on function public.pulse_match_product_images(uuid,text,text,integer),
  public.pulse_products_needing_embeddings(text,integer) to service_role;
