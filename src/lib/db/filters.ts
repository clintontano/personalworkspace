/**
 * Declarative filter model (stored as jsonb in views.config and reused by
 * automations). Evaluated in TS over fetched rows.
 */
import { datePart } from "./date-value";
import {
  isEmptyValue,
  valueOf,
  type Property,
  type Row,
} from "./model";

export type FilterOp =
  | "eq"
  | "ne"
  | "contains"
  | "not_contains"
  | "is_empty"
  | "is_not_empty"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "before"
  | "after"
  | "on";

export type FilterCondition = {
  property: string; // property id or "title"
  op: FilterOp;
  value?: unknown;
};

export type FilterGroup = {
  combinator: "and" | "or";
  conditions: (FilterCondition | FilterGroup)[];
};

export function isGroup(c: FilterCondition | FilterGroup): c is FilterGroup {
  return "combinator" in c;
}

export const EMPTY_FILTER: FilterGroup = { combinator: "and", conditions: [] };

function dateOnly(value: unknown): string | null {
  // Day-level semantics: "is on 29th" matches any time that day.
  return datePart(value);
}

export function evaluateCondition(
  row: Row,
  condition: FilterCondition,
  propertiesById: Map<string, Property>,
): boolean {
  const value = valueOf(row, condition.property);
  const type =
    condition.property === "title"
      ? "text"
      : propertiesById.get(condition.property)?.type ?? "text";

  switch (condition.op) {
    case "is_empty":
      return isEmptyValue(value);
    case "is_not_empty":
      return !isEmptyValue(value);
    default:
      break;
  }

  switch (type) {
    case "text":
    case "url":
    case "select": {
      const actual = typeof value === "string" ? value : "";
      const expected = typeof condition.value === "string" ? condition.value : "";
      switch (condition.op) {
        case "eq":
          return actual.toLowerCase() === expected.toLowerCase();
        case "ne":
          return actual.toLowerCase() !== expected.toLowerCase();
        case "contains":
          return actual.toLowerCase().includes(expected.toLowerCase());
        case "not_contains":
          return !actual.toLowerCase().includes(expected.toLowerCase());
        default:
          return false;
      }
    }
    case "multi_select":
    case "relation": {
      const actual = Array.isArray(value) ? value : [];
      const expected = typeof condition.value === "string" ? condition.value : "";
      switch (condition.op) {
        case "contains":
          return actual.includes(expected);
        case "not_contains":
          return !actual.includes(expected);
        case "eq":
          return actual.length === 1 && actual[0] === expected;
        default:
          return false;
      }
    }
    case "number": {
      const actual = typeof value === "number" ? value : null;
      const expected =
        typeof condition.value === "number"
          ? condition.value
          : Number(condition.value);
      if (actual === null || Number.isNaN(expected)) return false;
      switch (condition.op) {
        case "eq":
          return actual === expected;
        case "ne":
          return actual !== expected;
        case "gt":
          return actual > expected;
        case "gte":
          return actual >= expected;
        case "lt":
          return actual < expected;
        case "lte":
          return actual <= expected;
        default:
          return false;
      }
    }
    case "date": {
      const actual = dateOnly(value);
      const expected = dateOnly(condition.value);
      if (actual === null || expected === null) return false;
      switch (condition.op) {
        case "eq":
        case "on":
          return actual === expected;
        case "ne":
          return actual !== expected;
        case "before":
        case "lt":
          return actual < expected;
        case "after":
        case "gt":
          return actual > expected;
        case "gte":
          return actual >= expected;
        case "lte":
          return actual <= expected;
        default:
          return false;
      }
    }
    case "checkbox": {
      const actual = value === true;
      const expected =
        condition.value === undefined ? true : condition.value === true;
      switch (condition.op) {
        case "eq":
          return actual === expected;
        case "ne":
          return actual !== expected;
        default:
          return false;
      }
    }
    default:
      return false;
  }
}

export function evaluateFilter(
  row: Row,
  filter: FilterGroup | undefined,
  propertiesById: Map<string, Property>,
): boolean {
  if (!filter || filter.conditions.length === 0) return true;
  const results = filter.conditions.map((c) =>
    isGroup(c)
      ? evaluateFilter(row, c, propertiesById)
      : evaluateCondition(row, c, propertiesById),
  );
  return filter.combinator === "and" ? results.every(Boolean) : results.some(Boolean);
}
