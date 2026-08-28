-- Phase 5: automations.
--
-- Rules are declarative jsonb so a UI can be built on them later:
--   trigger: { type: 'row_created' | 'row_updated' | 'schedule',
--              databaseId?, filter?, cron? }
--   actions: [{ type: 'set_property', propertyId, value }
--            | { type: 'create_row', databaseId, title?, properties? }
--            | { type: 'notify', message }]
-- The filter shape is the same FilterGroup the views use.

create table public.automations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null default 'Untitled automation',
  trigger jsonb not null default '{}',
  actions jsonb not null default '[]',
  enabled boolean not null default true,
  last_run_at timestamptz,
  created_by uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger automations_set_updated_at
  before update on public.automations
  for each row execute function public.set_updated_at();

-- Append-only log so a run can be inspected without re-running it.
create table public.automation_runs (
  id uuid primary key default gen_random_uuid(),
  automation_id uuid not null references public.automations (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  status text not null check (status in ('ok', 'error', 'skipped')),
  detail jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index automation_runs_automation_idx
  on public.automation_runs (automation_id, created_at desc);

-- Notifications produced by the 'notify' action.
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  message text not null,
  page_id uuid references public.pages (id) on delete set null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index notifications_workspace_idx
  on public.notifications (workspace_id, created_at desc);

alter table public.automations enable row level security;
alter table public.automation_runs enable row level security;
alter table public.notifications enable row level security;

create policy "members full access to automations"
  on public.automations for all
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

create policy "members full access to automation_runs"
  on public.automation_runs for all
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

create policy "members full access to notifications"
  on public.notifications for all
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

-- Row-change queue -----------------------------------------------------------
-- Triggers cannot call the edge function directly, so row changes are queued
-- and drained by the same runner that handles scheduled rules.

create table public.automation_events (
  id bigserial primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  database_id uuid not null,
  page_id uuid not null,
  kind text not null check (kind in ('row_created', 'row_updated')),
  processed_at timestamptz,
  created_at timestamptz not null default now()
);

create index automation_events_pending_idx
  on public.automation_events (processed_at, created_at)
  where processed_at is null;

alter table public.automation_events enable row level security;

create policy "members read automation_events"
  on public.automation_events for select
  using (public.is_workspace_member(workspace_id));

create function public.enqueue_automation_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Skip writes made by the automation runner itself to avoid feedback loops.
  if current_setting('app.automation_run', true) = 'on' then
    return null;
  end if;

  insert into public.automation_events (workspace_id, database_id, page_id, kind)
  values (
    new.workspace_id,
    new.database_id,
    new.page_id,
    case when tg_op = 'INSERT' then 'row_created' else 'row_updated' end
  );
  return null;
end;
$$;

create trigger database_rows_enqueue_automation
  after insert or update on public.database_rows
  for each row execute function public.enqueue_automation_event();
