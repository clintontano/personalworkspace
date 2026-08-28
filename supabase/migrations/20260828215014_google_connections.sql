-- Phase 3: Google account connections (calendar sync now, Gmail in Phase 7).
-- Tokens are only read server-side; RLS restricts rows to their owner.

create table public.google_connections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('calendar', 'gmail')),
  email text not null,
  access_token text not null,
  refresh_token text not null,
  token_expires_at timestamptz not null,
  -- calendar: { calendarId, databaseId, datePropertyId, syncToken }
  config jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, kind)
);

create trigger google_connections_set_updated_at
  before update on public.google_connections
  for each row execute function public.set_updated_at();

alter table public.google_connections enable row level security;

create policy "owner full access to google_connections"
  on public.google_connections for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
