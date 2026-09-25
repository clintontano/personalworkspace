-- Give every MCP grant its own Supabase session.
--
-- Why the connector kept going stale: /api/oauth/authorize stored the
-- *browser's* Supabase refresh token with the grant, and /api/mcp rotated it
-- on every request. Browser and connector then shared one refresh-token
-- family. Supabase tolerates a client presenting the direct parent of the
-- active token, but once the connector was two or more rotations ahead, the
-- browser's next refresh presented a token Supabase had seen superseded. It
-- treats that as theft (refresh_token_already_used) and revokes the whole
-- family, which killed the connector too. Reconnecting often failed as well:
-- the browser still looked signed in until its access token expired, so a new
-- grant captured a refresh token that was already dead.
--
-- Now each grant gets a session minted for it alone at token exchange. It is
-- held once per grant, here, rather than copied into every rotated token row
-- (the copy raced with requests still in flight), refreshed only when its
-- access token is about to expire, and written back with a compare-and-swap
-- so an older token can never overwrite a newer one.
--
-- Idempotent, and safe to apply before the code that uses it ships, with one
-- deliberate exception at the end: it clears the browser refresh tokens that
-- pre-fix connections copied, which ends those connections. The new code
-- refuses them anyway, so reconnect once after deploying either way.
-- Run in the SQL editor:
--   https://supabase.com/dashboard/project/phlgxknlswghfrkncovn/sql/new

create table if not exists public.oauth_grants (
  id uuid primary key default gen_random_uuid(),
  client_id text not null references public.oauth_clients (client_id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  resource text,
  scope text,
  -- The connector's own session. Never shared with a browser.
  session_access_token text not null,
  session_refresh_token text not null,
  session_expires_at timestamptz not null,
  revoked_at timestamptz,
  revoked_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists oauth_grants_client_idx on public.oauth_grants (client_id);

drop trigger if exists oauth_grants_set_updated_at on public.oauth_grants;
create trigger oauth_grants_set_updated_at
  before update on public.oauth_grants
  for each row execute function public.set_updated_at();

-- Same posture as the other OAuth tables: RLS on with no policies, so anon and
-- authenticated get nothing; only the service role can reach it.
alter table public.oauth_grants enable row level security;
grant select, insert, update, delete on public.oauth_grants to service_role;
revoke all on public.oauth_grants from anon, authenticated;

-- Token rows point at their grant instead of carrying a copy of the session.
-- parent_id / rotated_at / used_at let a refresh token survive a lost response:
-- it stays exchangeable until the client proves it received the successor.
alter table public.oauth_tokens
  add column if not exists grant_id uuid references public.oauth_grants (id) on delete cascade;
alter table public.oauth_tokens
  add column if not exists parent_id uuid references public.oauth_tokens (id) on delete set null;
alter table public.oauth_tokens add column if not exists rotated_at timestamptz;
alter table public.oauth_tokens add column if not exists used_at timestamptz;
alter table public.oauth_tokens alter column supabase_refresh_token drop not null;

create index if not exists oauth_tokens_grant_idx on public.oauth_tokens (grant_id);
create index if not exists oauth_tokens_parent_idx on public.oauth_tokens (parent_id);

-- The authorize step no longer captures the browser's refresh token.
alter table public.oauth_codes alter column supabase_refresh_token drop not null;

create or replace function public.purge_expired_oauth()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.oauth_codes where expires_at < now() - interval '1 day';
  delete from public.oauth_tokens
   where revoked_at is not null and revoked_at < now() - interval '30 days';
  -- tokens cascade with their grant
  delete from public.oauth_grants
   where revoked_at is not null and revoked_at < now() - interval '30 days';
$$;

-- Old rows hold copies of browser refresh tokens in plaintext. The new code
-- never reads them, and grants that relied on them are refused, prompting
-- one reconnect. Clear them rather than leave live browser credentials here.
update public.oauth_tokens set supabase_refresh_token = null
 where grant_id is null and supabase_refresh_token is not null;
update public.oauth_codes set supabase_refresh_token = null
 where supabase_refresh_token is not null;

notify pgrst, 'reload schema';
