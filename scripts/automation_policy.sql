-- Let the runner mark automation events processed.
--
-- Run this in the Supabase SQL editor:
--   https://supabase.com/dashboard/project/phlgxknlswghfrkncovn/sql/new
--
-- automation_events had only a read policy, so "Run now" — which runs as the
-- signed-in user — could not set processed_at. RLS rejects a forbidden update
-- by changing zero rows rather than raising, so the failure was silent: the
-- same oldest batch was reprocessed every pass, the queue grew without bound,
-- and newly queued events were never reached.
--
-- Idempotent: Postgres has no CREATE POLICY IF NOT EXISTS, so drop first.

drop policy if exists "members update automation_events" on public.automation_events;

create policy "members update automation_events"
  on public.automation_events for update
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));
