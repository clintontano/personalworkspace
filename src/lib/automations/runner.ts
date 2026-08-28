/**
 * Automation runner: drains the row-change queue and evaluates scheduled
 * rules. Pure decisions live in ./rules and ./schedule; this module does I/O.
 *
 * Called by POST /api/automations/run (manually, by the scheduled edge
 * function, or by pg_cron via pg_net once deployed).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import type { Property, PropertyConfig, PropertyType, PropertyValue, Row } from "@/lib/db/model";
import { keyAfter } from "@/lib/order";
import {
  isNoopUpdate,
  matchesTrigger,
  planActions,
  type Automation,
  type EventKind,
  type Operation,
} from "./rules";
import { shouldRunNow } from "./schedule";

type Client = SupabaseClient<Database>;

export type RunSummary = {
  events: number;
  fired: number;
  operations: number;
  errors: string[];
};

async function loadProperties(
  supabase: Client,
  databaseId: string,
  cache: Map<string, Map<string, Property>>,
): Promise<Map<string, Property>> {
  const cached = cache.get(databaseId);
  if (cached) return cached;
  const { data } = await supabase
    .from("database_properties")
    .select("id, name, type, config, order_key")
    .eq("database_id", databaseId);
  const map = new Map<string, Property>(
    (data ?? []).map((p) => [
      p.id,
      {
        id: p.id,
        name: p.name,
        type: p.type as PropertyType,
        config: (p.config ?? {}) as PropertyConfig,
        order_key: p.order_key,
      },
    ]),
  );
  cache.set(databaseId, map);
  return map;
}

async function loadRow(supabase: Client, pageId: string): Promise<Row | null> {
  const { data } = await supabase
    .from("database_rows")
    .select("page_id, properties, order_key, created_at, updated_at, pages!inner(title, icon, archived_at)")
    .eq("page_id", pageId)
    .maybeSingle();
  if (!data) return null;
  const page = data.pages as unknown as {
    title: string;
    icon: string | null;
    archived_at: string | null;
  };
  if (page.archived_at) return null;
  return {
    pageId: data.page_id,
    title: page.title,
    icon: page.icon,
    properties: (data.properties ?? {}) as Record<string, PropertyValue>,
    orderKey: data.order_key,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
  };
}

async function applyOperations(
  supabase: Client,
  workspaceId: string,
  operations: Operation[],
  row: Row | null,
  summary: RunSummary,
) {
  for (const operation of operations) {
    try {
      if (operation.kind === "update_row") {
        if (row && isNoopUpdate(operation, row)) continue;
        const merged = { ...(row?.properties ?? {}), ...operation.properties };
        const { error } = await supabase
          .from("database_rows")
          .update({ properties: merged as Json })
          .eq("page_id", operation.pageId);
        if (error) throw error;
      } else if (operation.kind === "insert_row") {
        const { data: page, error: pageError } = await supabase
          .from("pages")
          .insert({
            workspace_id: workspaceId,
            parent_page_id: operation.databaseId,
            title: operation.title,
            order_key: keyAfter(null),
          })
          .select("id")
          .single();
        if (pageError) throw pageError;
        const { error } = await supabase.from("database_rows").insert({
          page_id: page.id,
          database_id: operation.databaseId,
          workspace_id: workspaceId,
          properties: operation.properties as Json,
          order_key: keyAfter(null),
        });
        if (error) throw error;
      } else {
        const { error } = await supabase.from("notifications").insert({
          workspace_id: workspaceId,
          message: operation.message,
          page_id: operation.pageId,
        });
        if (error) throw error;
      }
      summary.operations++;
    } catch (error) {
      summary.errors.push(String(error));
    }
  }
}

function toAutomation(raw: {
  id: string;
  name: string;
  trigger: Json;
  actions: Json;
  enabled: boolean;
}): Automation {
  return {
    id: raw.id,
    name: raw.name,
    enabled: raw.enabled,
    trigger: raw.trigger as unknown as Automation["trigger"],
    actions: (raw.actions ?? []) as unknown as Automation["actions"],
  };
}

/** One pass: drain queued row events, then evaluate scheduled rules. */
export async function runAutomations(
  supabase: Client,
  workspaceId: string,
  now = new Date(),
): Promise<RunSummary> {
  const summary: RunSummary = { events: 0, fired: 0, operations: 0, errors: [] };
  const propertyCache = new Map<string, Map<string, Property>>();

  const { data: automationRows } = await supabase
    .from("automations")
    .select("id, name, trigger, actions, enabled, last_run_at")
    .eq("workspace_id", workspaceId)
    .eq("enabled", true);
  const automations = (automationRows ?? []).map((a) => ({
    ...toAutomation(a),
    lastRunAt: a.last_run_at,
  }));
  if (automations.length === 0) return summary;

  // ---- queued row events ---------------------------------------------------
  const { data: events } = await supabase
    .from("automation_events")
    .select("id, database_id, page_id, kind")
    .eq("workspace_id", workspaceId)
    .is("processed_at", null)
    .order("created_at")
    .limit(200);

  for (const event of events ?? []) {
    summary.events++;
    const properties = await loadProperties(supabase, event.database_id, propertyCache);
    const row = await loadRow(supabase, event.page_id);

    for (const automation of automations) {
      if (!matchesTrigger(automation, { kind: event.kind as EventKind, databaseId: event.database_id })) {
        continue;
      }
      const operations = planActions(automation, row, properties);
      if (operations.length === 0) continue;
      summary.fired++;
      await applyOperations(supabase, workspaceId, operations, row, summary);
      await supabase.from("automation_runs").insert({
        automation_id: automation.id,
        workspace_id: workspaceId,
        status: summary.errors.length > 0 ? "error" : "ok",
        detail: { trigger: event.kind, pageId: event.page_id, operations: operations.length } as Json,
      });
    }

    await supabase
      .from("automation_events")
      .update({ processed_at: new Date().toISOString() })
      .eq("id", event.id);
  }

  // ---- scheduled rules -----------------------------------------------------
  for (const automation of automations) {
    if (automation.trigger.type !== "schedule") continue;
    if (!shouldRunNow(automation.trigger.cron, now, automation.lastRunAt)) continue;

    const databaseId = automation.trigger.databaseId;
    if (databaseId) {
      const properties = await loadProperties(supabase, databaseId, propertyCache);
      const { data: rowRecords } = await supabase
        .from("database_rows")
        .select("page_id, properties, order_key, created_at, updated_at, pages!inner(title, icon, archived_at)")
        .eq("database_id", databaseId)
        .is("pages.archived_at", null);

      for (const record of rowRecords ?? []) {
        const page = record.pages as unknown as { title: string; icon: string | null };
        const row: Row = {
          pageId: record.page_id,
          title: page.title,
          icon: page.icon,
          properties: (record.properties ?? {}) as Record<string, PropertyValue>,
          orderKey: record.order_key,
          createdAt: record.created_at,
          updatedAt: record.updated_at,
        };
        const operations = planActions(automation, row, properties);
        if (operations.length === 0) continue;
        summary.fired++;
        await applyOperations(supabase, workspaceId, operations, row, summary);
      }
    } else {
      const operations = planActions(automation, null, new Map());
      if (operations.length > 0) {
        summary.fired++;
        await applyOperations(supabase, workspaceId, operations, null, summary);
      }
    }

    await supabase
      .from("automations")
      .update({ last_run_at: now.toISOString() })
      .eq("id", automation.id);
    await supabase.from("automation_runs").insert({
      automation_id: automation.id,
      workspace_id: workspaceId,
      status: summary.errors.length > 0 ? "error" : "ok",
      detail: { trigger: "schedule" } as Json,
    });
  }

  return summary;
}
