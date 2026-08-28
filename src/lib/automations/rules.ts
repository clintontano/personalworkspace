/**
 * Declarative automation rules. Pure evaluation: given a rule and a row,
 * decide whether it fires and what operations to perform. The runner (edge
 * function / API route) executes the returned operations.
 */
import { evaluateFilter, type FilterGroup } from "@/lib/db/filters";
import type { Property, PropertyValue, Row } from "@/lib/db/model";

export type Trigger =
  | { type: "row_created"; databaseId: string; filter?: FilterGroup }
  | { type: "row_updated"; databaseId: string; filter?: FilterGroup }
  | { type: "schedule"; databaseId?: string; cron: string; filter?: FilterGroup };

export type Action =
  | { type: "set_property"; propertyId: string; value: PropertyValue }
  | {
      type: "create_row";
      databaseId: string;
      title?: string;
      properties?: Record<string, PropertyValue>;
    }
  | { type: "notify"; message: string };

export type Automation = {
  id: string;
  name: string;
  trigger: Trigger;
  actions: Action[];
  enabled: boolean;
};

export type EventKind = "row_created" | "row_updated" | "schedule";

export type Operation =
  | { kind: "update_row"; pageId: string; properties: Record<string, PropertyValue> }
  | {
      kind: "insert_row";
      databaseId: string;
      title: string;
      properties: Record<string, PropertyValue>;
    }
  | { kind: "notify"; message: string; pageId: string | null };

/** Does this automation respond to this event at all? */
export function matchesTrigger(
  automation: Automation,
  event: { kind: EventKind; databaseId?: string },
): boolean {
  if (!automation.enabled) return false;
  if (automation.trigger.type !== event.kind) return false;
  const triggerDatabase = automation.trigger.databaseId;
  if (triggerDatabase && event.databaseId && triggerDatabase !== event.databaseId) {
    return false;
  }
  return true;
}

/**
 * Substitute {{title}} and {{prop:<id>}} references in action strings.
 * Unknown references become an empty string rather than leaking the token.
 */
export function renderTemplate(
  template: string,
  row: Row | null,
  properties: Map<string, Property>,
): string {
  return template.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_match, token: string) => {
    if (!row) return "";
    if (token === "title") return row.title;
    const propMatch = /^prop:(.+)$/.exec(token);
    if (!propMatch) return "";
    const value = row.properties[propMatch[1]];
    if (value === null || value === undefined) return "";
    if (Array.isArray(value)) {
      return value
        .map((id) => optionName(properties.get(propMatch[1]), id))
        .join(", ");
    }
    if (typeof value === "boolean") return value ? "Yes" : "No";
    return optionName(properties.get(propMatch[1]), String(value));
  });
}

function optionName(property: Property | undefined, value: string): string {
  const option = property?.config.options?.find((o) => o.id === value);
  return option ? option.name : value;
}

/**
 * Operations for one automation firing on one row (or no row, for schedules
 * without a database). Returns an empty list when the row fails the filter.
 */
export function planActions(
  automation: Automation,
  row: Row | null,
  properties: Map<string, Property>,
): Operation[] {
  const filter = automation.trigger.filter;
  if (filter && row && !evaluateFilter(row, filter, properties)) return [];
  if (filter && !row) return [];

  const operations: Operation[] = [];
  // set_property actions on the same row are merged into a single update.
  let pending: Record<string, PropertyValue> | null = null;

  for (const action of automation.actions) {
    switch (action.type) {
      case "set_property": {
        if (!row) break;
        pending = { ...(pending ?? {}), [action.propertyId]: action.value };
        break;
      }
      case "create_row": {
        operations.push({
          kind: "insert_row",
          databaseId: action.databaseId,
          title: renderTemplate(action.title ?? "", row, properties),
          properties: action.properties ?? {},
        });
        break;
      }
      case "notify": {
        operations.push({
          kind: "notify",
          message: renderTemplate(action.message, row, properties),
          pageId: row?.pageId ?? null,
        });
        break;
      }
    }
  }

  if (pending && row) {
    operations.unshift({ kind: "update_row", pageId: row.pageId, properties: pending });
  }
  return operations;
}

/**
 * Would applying these operations change anything about the row? Used to skip
 * no-op updates, which would otherwise re-trigger row_updated automations.
 */
export function isNoopUpdate(
  operation: Operation,
  row: Row,
): boolean {
  if (operation.kind !== "update_row") return false;
  return Object.entries(operation.properties).every(
    ([key, value]) => JSON.stringify(row.properties[key]) === JSON.stringify(value),
  );
}
