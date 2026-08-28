"use client";

import { Play, Plus, Trash2, Zap } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import type { Action, Automation, Trigger } from "@/lib/automations/rules";
import type { Json } from "@/lib/database.types";
import { createClient } from "@/lib/supabase/client";

type DatabaseInfo = {
  id: string;
  title: string;
  properties: { id: string; name: string; type: string }[];
};

type AutomationRow = Automation & { lastRunAt: string | null };
type RunRow = { id: string; automationId: string; status: string; createdAt: string };

export function AutomationsScreen({
  workspaceId,
  initialAutomations,
  databases,
  initialRuns,
}: {
  workspaceId: string;
  initialAutomations: AutomationRow[];
  databases: DatabaseInfo[];
  initialRuns: RunRow[];
}) {
  const [automations, setAutomations] = useState(initialAutomations);
  const [runs] = useState(initialRuns);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async (id: string, patch: Partial<AutomationRow>) => {
    setAutomations((prev) => prev.map((a) => (a.id === id ? { ...a, ...patch } : a)));
    const supabase = createClient();
    await supabase
      .from("automations")
      .update({
        name: patch.name,
        enabled: patch.enabled,
        trigger: patch.trigger as unknown as Json | undefined,
        actions: patch.actions as unknown as Json | undefined,
      })
      .eq("id", id);
  };

  const create = async () => {
    const database = databases[0];
    const trigger: Trigger = {
      type: "row_updated",
      databaseId: database?.id ?? "",
    };
    const actions: Action[] = [{ type: "notify", message: "{{title}} changed" }];
    const supabase = createClient();
    const { data } = await supabase
      .from("automations")
      .insert({
        workspace_id: workspaceId,
        name: "New automation",
        trigger: trigger as unknown as Json,
        actions: actions as unknown as Json,
      })
      .select("id, name, trigger, actions, enabled, last_run_at")
      .single();
    if (data) {
      setAutomations((prev) => [
        ...prev,
        {
          id: data.id,
          name: data.name,
          enabled: data.enabled,
          trigger,
          actions,
          lastRunAt: null,
        },
      ]);
    }
  };

  const remove = async (id: string) => {
    setAutomations((prev) => prev.filter((a) => a.id !== id));
    const supabase = createClient();
    await supabase.from("automations").delete().eq("id", id);
  };

  const runNow = async () => {
    setBusy(true);
    setStatus(null);
    const response = await fetch("/api/automations/run", { method: "POST" });
    const data = await response.json();
    setStatus(
      response.ok
        ? `Ran: ${data.events} event(s), ${data.fired} rule(s) fired, ${data.operations} action(s)${
            data.errors?.length ? ` — ${data.errors.length} error(s)` : ""
          }`
        : `Failed: ${data.error}`,
    );
    setBusy(false);
  };

  return (
    <div className="mx-auto max-w-3xl px-8 py-12">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <Zap className="h-5 w-5" /> Automations
        </h1>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="gap-1"
            disabled={busy}
            data-testid="run-automations"
            onClick={() => void runNow()}
          >
            <Play className="h-3.5 w-3.5" /> {busy ? "Running…" : "Run now"}
          </Button>
          <Button size="sm" className="gap-1" onClick={() => void create()}>
            <Plus className="h-3.5 w-3.5" /> New
          </Button>
        </div>
      </div>

      {status ? (
        <p data-testid="run-status" className="mb-4 text-sm text-muted-foreground">
          {status}
        </p>
      ) : null}

      <div className="flex flex-col gap-3">
        {automations.map((automation) => (
          <AutomationCard
            key={automation.id}
            automation={automation}
            databases={databases}
            runs={runs.filter((r) => r.automationId === automation.id)}
            onSave={(patch) => void save(automation.id, patch)}
            onDelete={() => void remove(automation.id)}
          />
        ))}
        {automations.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No automations yet. They run when a row changes or on a schedule.
          </p>
        ) : null}
      </div>
    </div>
  );
}

function AutomationCard({
  automation,
  databases,
  runs,
  onSave,
  onDelete,
}: {
  automation: AutomationRow;
  databases: DatabaseInfo[];
  runs: RunRow[];
  onSave: (patch: Partial<AutomationRow>) => void;
  onDelete: () => void;
}) {
  const trigger = automation.trigger;
  const databaseId = "databaseId" in trigger ? trigger.databaseId : undefined;
  const database = databases.find((d) => d.id === databaseId);

  return (
    <div data-testid="automation-card" className="rounded-lg border p-4">
      <div className="mb-3 flex items-center gap-2">
        <Input
          value={automation.name}
          onChange={(e) => onSave({ name: e.target.value })}
          className="h-8 max-w-xs font-medium"
        />
        <label className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
          <Checkbox
            checked={automation.enabled}
            onCheckedChange={(checked) => onSave({ enabled: checked === true })}
          />
          Enabled
        </label>
        <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Delete automation" onClick={onDelete}>
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">When</span>
        <select
          className="h-8 rounded-md border bg-transparent px-1"
          value={trigger.type}
          onChange={(e) => {
            const type = e.target.value as Trigger["type"];
            onSave({
              trigger:
                type === "schedule"
                  ? { type, cron: "0 9 * * *", databaseId }
                  : { type, databaseId: databaseId ?? databases[0]?.id ?? "" },
            });
          }}
        >
          <option value="row_created">a row is created</option>
          <option value="row_updated">a row changes</option>
          <option value="schedule">on a schedule</option>
        </select>

        {trigger.type === "schedule" ? (
          <Input
            value={trigger.cron}
            aria-label="Cron expression"
            onChange={(e) => onSave({ trigger: { ...trigger, cron: e.target.value } })}
            className="h-8 w-32 font-mono text-xs"
          />
        ) : null}

        <span className="text-muted-foreground">in</span>
        <select
          className="h-8 rounded-md border bg-transparent px-1"
          value={databaseId ?? ""}
          onChange={(e) =>
            onSave({ trigger: { ...trigger, databaseId: e.target.value } as Trigger })
          }
        >
          <option value="">(any / none)</option>
          {databases.map((d) => (
            <option key={d.id} value={d.id}>{d.title}</option>
          ))}
        </select>
      </div>

      <div className="mt-3 flex flex-col gap-2">
        <span className="text-sm text-muted-foreground">Then</span>
        {automation.actions.map((action, index) => (
          <ActionRow
            key={index}
            action={action}
            database={database}
            databases={databases}
            onChange={(next) =>
              onSave({
                actions: automation.actions.map((a, i) => (i === index ? next : a)),
              })
            }
            onRemove={() =>
              onSave({ actions: automation.actions.filter((_, i) => i !== index) })
            }
          />
        ))}
        <Button
          variant="ghost"
          size="sm"
          className="gap-1 self-start text-muted-foreground"
          onClick={() =>
            onSave({ actions: [...automation.actions, { type: "notify", message: "" }] })
          }
        >
          <Plus className="h-3 w-3" /> Add action
        </Button>
      </div>

      {runs.length > 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">
          Last run {new Date(runs[0].createdAt).toLocaleString()} ({runs[0].status})
        </p>
      ) : null}
    </div>
  );
}

function ActionRow({
  action,
  database,
  databases,
  onChange,
  onRemove,
}: {
  action: Action;
  database: DatabaseInfo | undefined;
  databases: DatabaseInfo[];
  onChange: (action: Action) => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <select
        className="h-8 rounded-md border bg-transparent px-1"
        value={action.type}
        onChange={(e) => {
          const type = e.target.value as Action["type"];
          onChange(
            type === "notify"
              ? { type, message: "" }
              : type === "set_property"
                ? { type, propertyId: database?.properties[0]?.id ?? "", value: null }
                : { type, databaseId: databases[0]?.id ?? "", title: "" },
          );
        }}
      >
        <option value="notify">notify me</option>
        <option value="set_property">set a property</option>
        <option value="create_row">create a row</option>
      </select>

      {action.type === "notify" ? (
        <Input
          value={action.message}
          aria-label="Notification message"
          placeholder="{{title}} changed"
          onChange={(e) => onChange({ ...action, message: e.target.value })}
          className="h-8 flex-1"
        />
      ) : action.type === "set_property" ? (
        <>
          <select
            className="h-8 rounded-md border bg-transparent px-1"
            value={action.propertyId}
            onChange={(e) => onChange({ ...action, propertyId: e.target.value })}
          >
            {(database?.properties ?? []).map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <Input
            value={
              action.value === null || action.value === undefined
                ? ""
                : String(action.value)
            }
            aria-label="Property value"
            placeholder="value"
            onChange={(e) => onChange({ ...action, value: e.target.value })}
            className="h-8 w-40"
          />
        </>
      ) : (
        <>
          <select
            className="h-8 rounded-md border bg-transparent px-1"
            value={action.databaseId}
            onChange={(e) => onChange({ ...action, databaseId: e.target.value })}
          >
            {databases.map((d) => (
              <option key={d.id} value={d.id}>{d.title}</option>
            ))}
          </select>
          <Input
            value={action.title ?? ""}
            aria-label="New row title"
            placeholder="Follow up: {{title}}"
            onChange={(e) => onChange({ ...action, title: e.target.value })}
            className="h-8 flex-1"
          />
        </>
      )}

      <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Remove action" onClick={onRemove}>
        <Trash2 className="h-3 w-3" />
      </Button>
    </div>
  );
}
