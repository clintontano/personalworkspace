-- Phase 1: pages and blocks.
-- Ordering uses fractional index strings (lexicographic sort), so a reorder
-- is a single-row update. workspace_id is denormalized per convention.

create table public.pages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  parent_page_id uuid references public.pages (id) on delete cascade,
  title text not null default '',
  icon text,
  cover text,
  order_key text not null,
  archived_at timestamptz,
  created_by uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index pages_workspace_parent_order_idx
  on public.pages (workspace_id, parent_page_id, order_key);

create trigger pages_set_updated_at
  before update on public.pages
  for each row execute function public.set_updated_at();

create table public.blocks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  page_id uuid not null references public.pages (id) on delete cascade,
  parent_block_id uuid references public.blocks (id) on delete cascade,
  type text not null,
  content jsonb not null default '{}',
  order_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index blocks_page_parent_order_idx
  on public.blocks (page_id, parent_block_id, order_key);

create trigger blocks_set_updated_at
  before update on public.blocks
  for each row execute function public.set_updated_at();

alter table public.pages enable row level security;
alter table public.blocks enable row level security;

create policy "members full access to pages"
  on public.pages for all
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

create policy "members full access to blocks"
  on public.blocks for all
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));
