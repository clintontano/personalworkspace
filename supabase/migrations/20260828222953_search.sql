-- Phase 6: workspace search for the MCP server (and any future search UI).
--
-- SECURITY INVOKER (the default): the caller's RLS applies, so search can
-- only ever return rows the caller could already read. Plain ILIKE is enough
-- at personal scale; revisit with tsvector if a workspace ever gets large.

create function public.search_workspace(p_query text, p_limit int default 20)
returns table (
  page_id uuid,
  title text,
  icon text,
  is_database boolean,
  is_row boolean,
  snippet text,
  rank real
)
language sql
stable
as $$
  select distinct on (m.page_id)
    m.page_id, m.title, m.icon, m.is_database, m.is_row, m.snippet, m.rank
  from (
    select
      p.id as page_id,
      p.title,
      p.icon,
      exists (select 1 from public.databases d where d.page_id = p.id) as is_database,
      exists (select 1 from public.database_rows r where r.page_id = p.id) as is_row,
      null::text as snippet,
      2.0::real as rank
    from public.pages p
    where p.archived_at is null
      and p.title ilike '%' || p_query || '%'

    union all

    select
      p.id as page_id,
      p.title,
      p.icon,
      exists (select 1 from public.databases d where d.page_id = p.id) as is_database,
      exists (select 1 from public.database_rows r where r.page_id = p.id) as is_row,
      left(b.content ->> 'content', 200) as snippet,
      1.0::real as rank
    from public.blocks b
    join public.pages p on p.id = b.page_id
    where p.archived_at is null
      and b.content ->> 'content' ilike '%' || p_query || '%'
  ) m
  order by m.page_id, m.rank desc
  limit p_limit;
$$;

grant execute on function public.search_workspace(text, int) to authenticated;
