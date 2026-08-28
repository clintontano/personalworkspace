import { createClient } from "@/lib/supabase/server";
import type { Automation } from "@/lib/automations/rules";
import { AutomationsScreen } from "./automations-screen";

export default async function AutomationsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: membership } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", user!.id)
    .limit(1)
    .maybeSingle();
  const workspaceId = membership!.workspace_id;

  const [{ data: automations }, { data: databases }, { data: runs }] = await Promise.all([
    supabase
      .from("automations")
      .select("id, name, trigger, actions, enabled, last_run_at")
      .eq("workspace_id", workspaceId)
      .order("created_at"),
    supabase
      .from("databases")
      .select("page_id, pages!databases_page_id_fkey(title), database_properties(id, name, type, config)")
      .eq("workspace_id", workspaceId),
    supabase
      .from("automation_runs")
      .select("id, automation_id, status, detail, created_at")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  return (
    <AutomationsScreen
      workspaceId={workspaceId}
      initialAutomations={(automations ?? []).map((a) => ({
        id: a.id,
        name: a.name,
        enabled: a.enabled,
        trigger: a.trigger as unknown as Automation["trigger"],
        actions: (a.actions ?? []) as unknown as Automation["actions"],
        lastRunAt: a.last_run_at,
      }))}
      databases={(databases ?? []).map((d) => ({
        id: d.page_id,
        title: (d.pages as unknown as { title: string }).title || "Untitled",
        properties: (d.database_properties ?? []).map((p) => ({
          id: p.id,
          name: p.name,
          type: p.type,
        })),
      }))}
      initialRuns={(runs ?? []).map((r) => ({
        id: r.id,
        automationId: r.automation_id,
        status: r.status,
        createdAt: r.created_at,
      }))}
    />
  );
}
