-- Scheduled automations (run once against the hosted project, after the app
-- is deployed and the edge function exists).
--
-- Not a migration: it needs the deployed function URL and the service role
-- key, which are environment-specific.
--
--   1. supabase functions deploy automations --no-verify-jwt
--   2. supabase secrets set APP_URL=https://<your-app> AUTOMATION_RUN_SECRET=<secret>
--   3. run this in the SQL editor, replacing <project-ref> and <service-role-key>

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'run-automations',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://<project-ref>.supabase.co/functions/v1/automations',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer <service-role-key>"}'::jsonb
  );
  $$
);

-- To inspect or remove:
--   select * from cron.job;
--   select cron.unschedule('run-automations');
