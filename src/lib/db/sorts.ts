import { toInstant } from "./date-value";
import { isEmptyValue, valueOf, type Property, type Row } from "./model";

export type Sort = { property: string; direction: "asc" | "desc" };

function rank(value: unknown, type: string, property: Property | undefined): string | number {
  switch (type) {
    case "number":
      return typeof value === "number" ? value : Number.POSITIVE_INFINITY;
    case "checkbox":
      return value === true ? 1 : 0;
    case "date":
      // instants, so a timed value orders correctly against an all-day one
      // and across UTC offsets
      return toInstant(value) ?? Number.POSITIVE_INFINITY;
    case "select": {
      // Sort selects by their option order, matching Notion behaviour.
      const index = property?.config.options?.findIndex((o) => o.id === value) ?? -1;
      return index === -1 ? Number.MAX_SAFE_INTEGER : index;
    }
    case "multi_select":
    case "relation":
      return Array.isArray(value) ? value.length : 0;
    default:
      return typeof value === "string" ? value.toLowerCase() : "";
  }
}

export function compareRows(
  a: Row,
  b: Row,
  sorts: Sort[],
  propertiesById: Map<string, Property>,
): number {
  for (const sort of sorts) {
    const property = propertiesById.get(sort.property);
    const type = sort.property === "title" ? "text" : property?.type ?? "text";
    const va = valueOf(a, sort.property);
    const vb = valueOf(b, sort.property);

    // Empty values always sort last, regardless of direction.
    const ea = isEmptyValue(va);
    const eb = isEmptyValue(vb);
    if (ea !== eb) return ea ? 1 : -1;
    if (ea && eb) continue;

    const ra = rank(va, type, property);
    const rb = rank(vb, type, property);
    if (ra < rb) return sort.direction === "asc" ? -1 : 1;
    if (ra > rb) return sort.direction === "asc" ? 1 : -1;
  }
  // Stable fallback: manual order key.
  return a.orderKey < b.orderKey ? -1 : a.orderKey > b.orderKey ? 1 : 0;
}

export function sortRows(
  rows: Row[],
  sorts: Sort[],
  propertiesById: Map<string, Property>,
): Row[] {
  return [...rows].sort((a, b) => compareRows(a, b, sorts, propertiesById));
}
