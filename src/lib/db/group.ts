import { valueOf, type Property, type Row } from "./model";

export type RowGroup = {
  /** option id, "true"/"false" for checkbox, or null for "no value" */
  key: string | null;
  label: string;
  color?: string;
  rows: Row[];
};

/**
 * Group rows by a select or checkbox property. Group order follows the
 * property's option order; the "no value" group comes last.
 */
export function groupRows(
  rows: Row[],
  property: Property,
  fallbackLabel = "No value",
): RowGroup[] {
  const groups: RowGroup[] = [];

  if (property.type === "checkbox") {
    groups.push(
      { key: "false", label: "Unchecked", rows: [] },
      { key: "true", label: "Checked", rows: [] },
    );
    for (const row of rows) {
      const checked = valueOf(row, property.id) === true;
      groups[checked ? 1 : 0].rows.push(row);
    }
    return groups;
  }

  const options = property.config.options ?? [];
  const byKey = new Map<string | null, RowGroup>();
  for (const option of options) {
    const group: RowGroup = {
      key: option.id,
      label: option.name,
      color: option.color,
      rows: [],
    };
    groups.push(group);
    byKey.set(option.id, group);
  }
  const noValue: RowGroup = { key: null, label: fallbackLabel, rows: [] };

  for (const row of rows) {
    const value = valueOf(row, property.id);
    const group = typeof value === "string" ? byKey.get(value) : undefined;
    (group ?? noValue).rows.push(row);
  }

  groups.push(noValue);
  return groups;
}
