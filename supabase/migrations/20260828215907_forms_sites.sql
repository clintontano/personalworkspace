-- Phase 4: public forms and published sites.
--
-- Public access design: anon gets NO table policies. Every public read/write
-- goes through a security definer RPC that enforces its own rule (form is
-- enabled / page belongs to a published site subtree). The public surface is
-- therefore fixed in SQL rather than depending on route code holding a
-- service-role key.

create table public.forms (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  database_id uuid not null references public.databases (page_id) on delete cascade,
  slug text not null unique,
  title text not null default 'Untitled form',
  description text,
  -- [{ propertyId, label, required, placeholder }]; the row title is the
  -- reserved propertyId "title".
  fields jsonb not null default '[]',
  enabled boolean not null default true,
  created_by uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index forms_database_idx on public.forms (database_id);

create trigger forms_set_updated_at
  before update on public.forms
  for each row execute function public.set_updated_at();

create table public.form_submissions (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null references public.forms (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  data jsonb not null default '{}',
  row_page_id uuid references public.pages (id) on delete set null,
  created_at timestamptz not null default now()
);

create index form_submissions_form_idx on public.form_submissions (form_id, created_at desc);

create table public.sites (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  page_id uuid not null references public.pages (id) on delete cascade,
  slug text not null unique,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index sites_page_idx on public.sites (page_id);

create trigger sites_set_updated_at
  before update on public.sites
  for each row execute function public.set_updated_at();

alter table public.forms enable row level security;
alter table public.form_submissions enable row level security;
alter table public.sites enable row level security;

create policy "members full access to forms"
  on public.forms for all
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

create policy "members full access to form_submissions"
  on public.form_submissions for all
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

create policy "members full access to sites"
  on public.sites for all
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

-- ---------------------------------------------------------------------------
-- Public form rendering + submission
-- ---------------------------------------------------------------------------

-- Form definition for rendering. Only enabled forms; never exposes row data.
create function public.get_public_form(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'slug', f.slug,
    'title', f.title,
    'description', f.description,
    'fields', f.fields,
    'properties', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object('id', dp.id, 'name', dp.name, 'type', dp.type, 'config', dp.config)
          order by dp.order_key
        )
        from public.database_properties dp
        where dp.database_id = f.database_id
      ),
      '[]'::jsonb
    )
  )
  from public.forms f
  where f.slug = p_slug and f.enabled;
$$;

grant execute on function public.get_public_form(text) to anon, authenticated;

-- Submit a form: creates the row page + database row + submission record.
-- Only property ids that belong to the form's database and are listed in the
-- form's fields are accepted; everything else in p_data is ignored.
create function public.submit_public_form(p_slug text, p_data jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_form public.forms;
  v_title text;
  v_props jsonb := '{}'::jsonb;
  v_field jsonb;
  v_property_id text;
  v_value jsonb;
  v_page_id uuid;
  v_submission_id uuid;
  v_order_key text;
begin
  select * into v_form from public.forms where slug = p_slug and enabled;
  if v_form is null then
    raise exception 'form not found or disabled';
  end if;

  v_title := coalesce(p_data ->> 'title', '');

  for v_field in select * from jsonb_array_elements(v_form.fields)
  loop
    v_property_id := v_field ->> 'propertyId';
    continue when v_property_id is null or v_property_id = 'title';

    -- the property must belong to this form's database
    if not exists (
      select 1 from public.database_properties dp
      where dp.id::text = v_property_id and dp.database_id = v_form.database_id
    ) then
      continue;
    end if;

    v_value := p_data -> v_property_id;
    if v_value is not null and v_value <> 'null'::jsonb then
      v_props := v_props || jsonb_build_object(v_property_id, v_value);
    end if;

    if coalesce((v_field ->> 'required')::boolean, false)
       and (v_value is null or v_value = 'null'::jsonb or v_value = '""'::jsonb) then
      raise exception 'missing required field %', v_field ->> 'label';
    end if;
  end loop;

  select coalesce(max(order_key), 'a0') into v_order_key
  from public.database_rows where database_id = v_form.database_id;

  insert into public.pages (workspace_id, parent_page_id, title, order_key, created_by)
  values (v_form.workspace_id, v_form.database_id, v_title, v_order_key || 'V', v_form.created_by)
  returning id into v_page_id;

  insert into public.database_rows (page_id, database_id, workspace_id, properties, order_key)
  values (v_page_id, v_form.database_id, v_form.workspace_id, v_props, v_order_key || 'V');

  insert into public.form_submissions (form_id, workspace_id, data, row_page_id)
  values (v_form.id, v_form.workspace_id, p_data, v_page_id)
  returning id into v_submission_id;

  return v_submission_id;
end;
$$;

grant execute on function public.submit_public_form(text, jsonb) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Public site rendering
-- ---------------------------------------------------------------------------

-- A page and its blocks, only if it sits inside a published site's subtree.
create function public.get_public_site_page(p_slug text, p_page_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_site public.sites;
  v_root uuid;
  v_page_id uuid;
  v_result jsonb;
begin
  select * into v_site from public.sites
  where slug = p_slug and published_at is not null;
  if v_site is null then
    return null;
  end if;
  v_root := v_site.page_id;
  v_page_id := coalesce(p_page_id, v_root);

  -- the requested page must be the root or a descendant of it
  if not exists (
    with recursive tree as (
      select id from public.pages where id = v_root and archived_at is null
      union all
      select p.id from public.pages p
        join tree t on p.parent_page_id = t.id
      where p.archived_at is null
    )
    select 1 from tree where id = v_page_id
  ) then
    return null;
  end if;

  select jsonb_build_object(
    'siteSlug', v_site.slug,
    'rootPageId', v_root,
    'page', jsonb_build_object('id', pg.id, 'title', pg.title, 'icon', pg.icon),
    'blocks', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', b.id,
            'parent_block_id', b.parent_block_id,
            'type', b.type,
            'content', b.content,
            'order_key', b.order_key
          ) order by b.order_key
        )
        from public.blocks b where b.page_id = pg.id
      ),
      '[]'::jsonb
    ),
    'children', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object('id', c.id, 'title', c.title, 'icon', c.icon)
          order by c.order_key
        )
        from public.pages c
        where c.parent_page_id = pg.id
          and c.archived_at is null
          -- database rows are not site pages
          and not exists (select 1 from public.database_rows dr where dr.page_id = c.id)
      ),
      '[]'::jsonb
    )
  )
  into v_result
  from public.pages pg
  where pg.id = v_page_id;

  return v_result;
end;
$$;

grant execute on function public.get_public_site_page(text, uuid) to anon, authenticated;
