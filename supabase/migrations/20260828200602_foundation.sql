-- Phase 0: workspaces, membership, RLS foundation.
-- Conventions established here and reused by every later migration:
--   * every table gets created_at/updated_at, updated_at maintained by trigger
--   * every table carries workspace_id and is RLS'd via is_workspace_member()
--   * helper functions are security definer with an empty search_path

-- updated_at maintenance ----------------------------------------------------

create function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- workspaces ----------------------------------------------------------------

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  icon text,
  created_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger workspaces_set_updated_at
  before update on public.workspaces
  for each row execute function public.set_updated_at();

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create index workspace_members_user_id_idx on public.workspace_members (user_id);

-- membership helpers --------------------------------------------------------
-- security definer so RLS policies can consult workspace_members without
-- recursing into that table's own policies.

create function public.is_workspace_member(ws_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.workspace_members
    where workspace_id = ws_id and user_id = auth.uid()
  );
$$;

create function public.is_workspace_owner(ws_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.workspace_members
    where workspace_id = ws_id and user_id = auth.uid() and role = 'owner'
  );
$$;

-- RLS -----------------------------------------------------------------------

alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;

create policy "members can read their workspaces"
  on public.workspaces for select
  using (public.is_workspace_member(id));

create policy "members can update their workspaces"
  on public.workspaces for update
  using (public.is_workspace_member(id))
  with check (public.is_workspace_member(id));

create policy "authenticated users can create workspaces"
  on public.workspaces for insert
  with check (created_by = auth.uid());

create policy "owners can delete their workspaces"
  on public.workspaces for delete
  using (public.is_workspace_owner(id));

create policy "members can see co-members"
  on public.workspace_members for select
  using (user_id = auth.uid() or public.is_workspace_member(workspace_id));

create policy "owners can add members"
  on public.workspace_members for insert
  with check (
    public.is_workspace_owner(workspace_id)
    -- bootstrap: the creator of a fresh workspace adds themselves as owner
    or (
      user_id = auth.uid()
      and role = 'owner'
      and exists (
        select 1 from public.workspaces w
        where w.id = workspace_id and w.created_by = auth.uid()
      )
    )
  );

create policy "owners can update members"
  on public.workspace_members for update
  using (public.is_workspace_owner(workspace_id));

create policy "owners can remove members"
  on public.workspace_members for delete
  using (public.is_workspace_owner(workspace_id) or user_id = auth.uid());

-- auto-provision a workspace on signup --------------------------------------

create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  ws_id uuid;
begin
  insert into public.workspaces (name, created_by)
  values (initcap(split_part(new.email, '@', 1)) || '''s Workspace', new.id)
  returning id into ws_id;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (ws_id, new.id, 'owner');

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
