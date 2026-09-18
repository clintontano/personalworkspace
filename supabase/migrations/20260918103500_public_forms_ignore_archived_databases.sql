-- Public forms must go quiet when their database is deleted.
--
-- Deleting a database archives its page (the sidebar delete button and the MCP
-- `delete_page` tool both do this), but the form RPCs only checked
-- `forms.enabled`. So a published form stayed live at /f/<slug>, rendering and
-- still accepting submissions that inserted rows into a database the owner had
-- deleted. `get_public_site_page` already filters `archived_at is null` for both
-- a site's root and its subtree; forms now match.
--
-- Both functions are replaced rather than edited in place: their signatures and
-- return types are unchanged, so `create or replace` keeps existing grants, and
-- they are re-granted below anyway to keep this migration self-contained.

create or replace function public.get_public_form(p_slug text)
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
  join public.databases d on d.page_id = f.database_id
  join public.pages p on p.id = d.page_id
  where f.slug = p_slug and f.enabled and p.archived_at is null;
$$;

grant execute on function public.get_public_form(text) to anon, authenticated;

create or replace function public.submit_public_form(p_slug text, p_data jsonb)
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
  -- The message stays deliberately vague: an anonymous visitor has no business
  -- learning whether the owner disabled the form or deleted its database.
  select f.* into v_form
  from public.forms f
  join public.databases d on d.page_id = f.database_id
  join public.pages p on p.id = d.page_id
  where f.slug = p_slug and f.enabled and p.archived_at is null;
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
