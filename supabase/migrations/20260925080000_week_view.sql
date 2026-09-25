-- Week views: Monday-to-Sunday sections numbered from an anchor date held in
-- the view's config. Only the type whitelist changes; nothing else about a
-- view is per-type, so no new columns are needed.

alter table public.views drop constraint if exists views_type_check;

alter table public.views
  add constraint views_type_check
  check (type in ('table', 'board', 'list', 'calendar', 'week'));
