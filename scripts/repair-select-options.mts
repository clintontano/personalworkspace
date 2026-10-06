/**
 * Repair select values that match no option.
 *
 * Before the connector learned to create missing options, setting a select to
 * a label it did not have stored the raw label instead of an option id. Nothing
 * reads such a value back: cells show nothing, and a board grouped by that
 * property files the row under "No value".
 *
 * For every select and multi-select property, each stored value that is not an
 * option id becomes one: remapped to the option of that name if one exists,
 * otherwise added as a new option (in natural order, so "Week 3" comes before
 * "Week 10") and remapped to it.
 *
 * Dry run by default; prints the plan and writes nothing.
 * Usage: npx tsx scripts/repair-select-options.mts [--apply]
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import type { Property, PropertyValue } from "../src/lib/db/model";
import { withMissingOptions } from "../src/lib/mcp/api";

config({ path: ".env.local", quiet: true });
const apply = process.argv.includes("--apply");
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

function must<T>(result: { data: T; error: { message: string } | null }): NonNullable<T> {
  if (result.error) throw new Error(result.error.message);
  if (result.data === null || result.data === undefined) throw new Error("no data returned");
  return result.data as NonNullable<T>;
}

const properties = must(
  await db
    .from("database_properties")
    .select("id, name, type, config, order_key, database_id, databases!inner(pages!databases_page_id_fkey!inner(title))")
    .in("type", ["select", "multi_select"]),
);

let rowsToFix = 0;
const plan: { property: Property; databaseId: string; rows: { pageId: string; value: PropertyValue }[] }[] = [];

for (const raw of properties) {
  const property = { ...raw, config: raw.config ?? {} } as unknown as Property;
  const databaseTitle = (raw.databases as unknown as { pages: { title: string } }).pages.title;
  const ids = new Set((property.config.options ?? []).map((o) => o.id));
  const rows = must(
    await db.from("database_rows").select("page_id, properties").eq("database_id", raw.database_id),
  );

  const values = (v: unknown) => (Array.isArray(v) ? v : v === undefined || v === null ? [] : [v]);
  const unknownLabels = new Set<string>();
  for (const row of rows) {
    for (const v of values((row.properties as Record<string, unknown>)[property.id])) {
      if (typeof v === "string" && v !== "" && !ids.has(v)) unknownLabels.add(v);
    }
  }
  if (unknownLabels.size === 0) continue;

  // natural order, so "Week 3" lands before "Week 10"
  const ordered = [...unknownLabels].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const { property: next, added } = withMissingOptions(property, ordered);
  const byLabel = new Map(
    (next.config.options ?? []).map((o) => [o.name.toLowerCase(), o.id] as const),
  );
  const toId = (label: string) => (ids.has(label) ? label : byLabel.get(label.toLowerCase()) ?? label);

  const changed: { pageId: string; value: PropertyValue }[] = [];
  for (const row of rows) {
    const current = (row.properties as Record<string, PropertyValue>)[property.id];
    if (current === undefined || current === null) continue;
    const fixed = Array.isArray(current) ? current.map((v) => toId(String(v))) : toId(String(current));
    if (JSON.stringify(fixed) !== JSON.stringify(current)) changed.push({ pageId: row.page_id, value: fixed });
  }

  console.log(
    `\n"${databaseTitle || "Untitled"}" (${raw.database_id.slice(0, 8)}) → ${property.name} (${property.type})`,
  );
  for (const label of ordered) {
    const option = added.find((o) => o.name === label);
    console.log(`  ${option ? "new option " : "existing   "} ${label}`);
  }
  console.log(`  ${changed.length} row(s) to remap`);
  rowsToFix += changed.length;
  plan.push({ property: next, databaseId: raw.database_id, rows: changed });
}

if (plan.length === 0) {
  console.log("Every select value matches an option. Nothing to do.");
  process.exit(0);
}

// Only row_updated rules react to these writes; the database sits in the trigger.
const databases = new Set(plan.map((p) => p.databaseId));
const rules = must(await db.from("automations").select("name, trigger").eq("enabled", true));
const watching = rules.filter((r) => {
  const trigger = r.trigger as { type?: string; databaseId?: string };
  return trigger.type === "row_updated" && databases.has(trigger.databaseId ?? "");
});
console.log(
  `\n${rowsToFix} row(s) in total. Each update enqueues a row_updated automation event; ` +
    `enabled row_updated automations on these databases: ` +
    (watching.length ? watching.map((r) => `"${r.name}"`).join(", ") : "none") +
    ".",
);

if (!apply) {
  console.log("\nDry run: nothing written. Re-run with --apply to make these changes.");
  process.exit(0);
}

for (const { property, rows } of plan) {
  const updated = must(
    await db.from("database_properties").update({ config: property.config }).eq("id", property.id).select("id"),
  );
  if (updated.length !== 1) throw new Error(`could not update options on ${property.name}`);
  for (const { pageId, value } of rows) {
    const { properties: current } = must(
      await db.from("database_rows").select("properties").eq("page_id", pageId).single(),
    ) as { properties: Record<string, PropertyValue> };
    const written = must(
      await db
        .from("database_rows")
        .update({ properties: { ...current, [property.id]: value } })
        .eq("page_id", pageId)
        .select("page_id"),
    );
    if (written.length !== 1) throw new Error(`could not update row ${pageId}`);
  }
}
console.log(`\nApplied: ${rowsToFix} row(s) remapped.`);
