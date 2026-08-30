-- Remote MCP server tables.
--
-- Run this in the Supabase SQL editor:
--   https://supabase.com/dashboard/project/phlgxknlswghfrkncovn/sql/new
--
-- The CLI could not apply it: `supabase db push` recorded the migrations in
-- the history without committing their DDL, so the tables never existed.
-- This script is idempotent — safe to run more than once.

create table if not exists public.oauth_clients (
  client_id text primary key,
  client_secret_hash text,
  client_name text not null default 'MCP client',
  redirect_uris text[] not null,
  created_at timestamptz not null default now()
);

create table if not exists public.oauth_codes (
  code_hash text primary key,
  client_id text not null references public.oauth_clients (client_id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  redirect_uri text not null,
  code_challenge text not null,
  code_challenge_method text not null default 'S256',
  resource text,
  scope text,
  supabase_refresh_token text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.oauth_tokens (
  id uuid primary key default gen_random_uuid(),
  access_token_hash text not null unique,
  refresh_token_hash text unique,
  client_id text not null references public.oauth_clients (client_id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  resource text,
  scope text,
  supabase_refresh_token text not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.oauth_clients enable row level security;
alter table public.oauth_codes  enable row level security;
alter table public.oauth_tokens enable row level security;

create index if not exists oauth_codes_expires_idx  on public.oauth_codes (expires_at);
create index if not exists oauth_tokens_refresh_idx on public.oauth_tokens (refresh_token_hash);
create index if not exists oauth_tokens_expires_idx on public.oauth_tokens (expires_at);

-- RLS is on with no policies, so anon and authenticated get nothing at all.
-- The service role still needs table privileges, or PostgREST will not expose
-- the tables and every request fails with PGRST205.
grant select, insert, update, delete on public.oauth_clients to service_role;
grant select, insert, update, delete on public.oauth_codes  to service_role;
grant select, insert, update, delete on public.oauth_tokens to service_role;
revoke all on public.oauth_clients from anon, authenticated;
revoke all on public.oauth_codes  from anon, authenticated;
revoke all on public.oauth_tokens from anon, authenticated;

create or replace function public.purge_expired_oauth()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.oauth_codes where expires_at < now() - interval '1 day';
  delete from public.oauth_tokens
   where revoked_at is not null and revoked_at < now() - interval '30 days';
$$;

notify pgrst, 'reload schema';
