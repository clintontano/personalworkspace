// Scheduled automation runner.
//
// Deploy:  supabase functions deploy automations --no-verify-jwt
// Secrets: supabase secrets set APP_URL=https://<your-app> \
//                               AUTOMATION_RUN_SECRET=<same as .env.local>
//
// The rule engine itself lives in the Next.js app (src/lib/automations) so
// there is exactly one implementation; this function is the scheduled trigger
// that invokes it. pg_cron calls this function — see scripts/pg_cron_setup.sql.

Deno.serve(async () => {
  const appUrl = Deno.env.get("APP_URL");
  const secret = Deno.env.get("AUTOMATION_RUN_SECRET");

  if (!appUrl || !secret) {
    return new Response(
      JSON.stringify({ error: "APP_URL and AUTOMATION_RUN_SECRET must be set" }),
      { status: 500, headers: { "content-type": "application/json" } },
    );
  }

  const response = await fetch(`${appUrl}/api/automations/run`, {
    method: "POST",
    headers: { "x-automation-secret": secret, "content-type": "application/json" },
  });

  return new Response(await response.text(), {
    status: response.status,
    headers: { "content-type": "application/json" },
  });
});
