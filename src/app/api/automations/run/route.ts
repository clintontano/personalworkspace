import { NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { runAutomations } from "@/lib/automations/runner";
import { publicEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

/**
 * POST /api/automations/run
 *
 * Two callers:
 *  - a signed-in user ("Run now"), which runs their own workspace under RLS
 *  - the scheduler (edge function / pg_cron), authenticated with
 *    AUTOMATION_RUN_SECRET, which runs every workspace with the service role
 */
export async function POST(request: Request) {
  const secret = process.env.AUTOMATION_RUN_SECRET;
  const provided = request.headers.get("x-automation-secret");

  if (secret && provided === secret) {
    const admin = createServiceClient<Database>(
      publicEnv().NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const { data: workspaces } = await admin.from("workspaces").select("id");
    const results = [];
    for (const workspace of workspaces ?? []) {
      results.push({ workspaceId: workspace.id, ...(await runAutomations(admin, workspace.id)) });
    }
    return NextResponse.json({ scheduled: true, results });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: membership } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();
  if (!membership) return NextResponse.json({ error: "no workspace" }, { status: 404 });

  const summary = await runAutomations(supabase, membership.workspace_id);
  return NextResponse.json(summary);
}
