-- Phase 2: databases, properties, rows, views.
-- A database is a page with a `databases` row. A database row IS a page
-- (title lives on the page); property values live in one jsonb per row.
-- No per-property generated columns: GIN index + client-side evaluation at
-- personal scale (decision logged in CLAUDE.md).

create table public.databases (
  page_id uuid primary key references public.pages (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger databases_set_updated_at
  before update on public.databases
  for each row execute function public.set_updated_at();

create table public.database_properties (
  id uuid primary key default gen_random_uuid(),
  database_id uuid not null references public.databases (page_id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null,
  type text not null check (
    type in ('text', 'number', 'select', 'multi_select', 'date', 'checkbox', 'url', 'relation')
  ),
  config jsonb not null default '{}',
  order_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index database_properties_database_idx
  on public.database_properties (database_id, order_key);

create trigger database_properties_set_updated_at
  before update on public.database_properties
  for each row execute function public.set_updated_at();

create table public.database_rows (
  page_id uuid primary key references public.pages (id) on delete cascade,
  database_id uuid not null references public.databases (page_id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  properties jsonb not null default '{}',
  order_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index database_rows_database_idx
  on public.database_rows (database_id, order_key);

create index database_rows_properties_idx
  on public.database_rows using gin (properties jsonb_path_ops);

create trigger database_rows_set_updated_at
  before update on public.database_rows
  for each row execute function public.set_updated_at();

create table public.views (
  id uuid primary key default gen_random_uuid(),
  database_id uuid not null references public.databases (page_id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null,
  type text not null check (type in ('table', 'board', 'list', 'calendar')),
  config jsonb not null default '{}',
  order_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index views_database_idx on public.views (database_id, order_key);

create trigger views_set_updated_at
  before update on public.views
  for each row execute function public.set_updated_at();

alter table public.databases enable row level security;
alter table public.database_properties enable row level security;
alter table public.database_rows enable row level security;
alter table public.views enable row level security;

create policy "members full access to databases"
  on public.databases for all
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

create policy "members full access to database_properties"
  on public.database_properties for all
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

create policy "members full access to database_rows"
  on public.database_rows for all
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

create policy "members full access to views"
  on public.views for all
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));
