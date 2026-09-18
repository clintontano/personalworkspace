import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import type { ViewConfig } from "./data";
import { isGroup, type FilterGroup } from "./filters";

/**
 * Remove every reference to a property from a view's config.
 *
 * Deleting a property leaves views that filter, sort or group by it pointing at
 * an id that no longer resolves. That does not throw — `evaluateCondition`
 * falls back to treating the missing value as empty text — it silently matches
 * nothing, so the rows read as having vanished along with the column. Pruning
 * the config first is cheaper than debugging that.
 */
export function withoutProperty(config: ViewConfig, propertyId: string): ViewConfig {
  const next: ViewConfig = { ...config };

  if (next.filter) next.filter = pruneFilter(next.filter, propertyId);
  if (next.sorts) next.sorts = next.sorts.filter((sort) => sort.property !== propertyId);
  if (next.hidden) next.hidden = next.hidden.filter((id) => id !== propertyId);
  if (next.groupBy === propertyId) delete next.groupBy;
  if (next.dateProperty === propertyId) delete next.dateProperty;
  if (next.columnWidths && propertyId in next.columnWidths) {
    const { [propertyId]: _dropped, ...rest } = next.columnWidths;
    next.columnWidths = rest;
  }

  return next;
}

function pruneFilter(filter: FilterGroup, propertyId: string): FilterGroup {
  return {
    combinator: filter.combinator,
    conditions: filter.conditions
      .map((condition) =>
        isGroup(condition) ? pruneFilter(condition, propertyId) : condition,
      )
      // A group emptied by the prune is dropped rather than kept: an empty
      // group evaluates to true, which would widen an `or` to match every row.
      .filter((condition) =>
        isGroup(condition)
          ? condition.conditions.length > 0
          : condition.property !== propertyId,
      ),
  };
}

/** Whether pruning would change anything, so a no-op write can be skipped. */
export function configMentions(config: ViewConfig, propertyId: string): boolean {
  return JSON.stringify(withoutProperty(config, propertyId)) !== JSON.stringify(config);
}

/**
 * Prune a property out of every view of a database. Returns the number of
 * views changed.
 *
 * Called before the property is deleted, so no view ever references one that
 * is already gone. Shared by the app's column menu and the MCP delete tool.
 */
export async function pruneViewsOfProperty(
  supabase: SupabaseClient<Database>,
  databaseId: string,
  propertyId: string,
): Promise<number> {
  const { data: views, error } = await supabase
    .from("views")
    .select("id, config")
    .eq("database_id", databaseId);
  if (error) throw error;

  let updated = 0;
  for (const view of views ?? []) {
    const config = (view.config ?? {}) as ViewConfig;
    if (!configMentions(config, propertyId)) continue;
    const { error: updateError } = await supabase
      .from("views")
      .update({ config: withoutProperty(config, propertyId) as Json })
      .eq("id", view.id);
    if (updateError) throw updateError;
    updated += 1;
  }
  return updated;
}
