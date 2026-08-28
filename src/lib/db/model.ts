/**
 * Canonical types for the database (Notion-style) layer.
 *
 * Property value formats inside database_rows.properties (keyed by property id):
 *   text: string | number: number | select: option id | multi_select: option ids
 *   date: ISO string (yyyy-mm-dd or full timestamp) | checkbox: boolean
 *   url: string | relation: page ids
 * "title" is a virtual property backed by the row's page title.
 */

export type PropertyType =
  | "text"
  | "number"
  | "select"
  | "multi_select"
  | "date"
  | "checkbox"
  | "url"
  | "relation";

export type SelectOption = { id: string; name: string; color: string };

export type PropertyConfig = {
  options?: SelectOption[];
  /** relation: the target database page id */
  databaseId?: string;
};

export type Property = {
  id: string;
  name: string;
  type: PropertyType;
  config: PropertyConfig;
  order_key: string;
};

export type PropertyValue = string | number | boolean | string[] | null | undefined;

export type Row = {
  pageId: string;
  title: string;
  icon: string | null;
  properties: Record<string, PropertyValue>;
  orderKey: string;
  createdAt: string;
  updatedAt: string;
};

export const TITLE_PROPERTY = "title" as const;

export function valueOf(row: Row, propertyId: string): PropertyValue {
  if (propertyId === TITLE_PROPERTY) return row.title;
  return row.properties[propertyId];
}

export function isEmptyValue(value: PropertyValue): boolean {
  return (
    value === null ||
    value === undefined ||
    value === "" ||
    (Array.isArray(value) && value.length === 0)
  );
}
