import { keyAfter } from "@/lib/order";
import { createClient } from "@/lib/supabase/client";
import type { Json } from "@/lib/database.types";
import type { FilterGroup } from "./filters";
import type { Property, PropertyConfig, PropertyType, PropertyValue, Row } from "./model";
import type { Sort } from "./sorts";

export type ViewType = "table" | "board" | "list" | "calendar";

export type ViewConfig = {
  filter?: FilterGroup;
  sorts?: Sort[];
  /** table: optional section grouping; board: column property */
  groupBy?: string;
  /** property ids hidden in this view */
  hidden?: string[];
  /** calendar: the date property to place rows by */
  dateProperty?: string;
  /** table: pixel widths keyed by property id, plus "title" for the first column */
  columnWidths?: Record<string, number>;
};

export type ViewRecord = {
  id: string;
  name: string;
  type: ViewType;
  config: ViewConfig;
  order_key: string;
};

export type DatabaseBundle = {
  pageId: string;
  title: string;
  icon: string | null;
  properties: Property[];
  views: ViewRecord[];
  rows: Row[];
};

function toProperty(raw: {
  id: string;
  name: string;
  type: string;
  config: Json;
  order_key: string;
}): Property {
  return {
    id: raw.id,
    name: raw.name,
    type: raw.type as PropertyType,
    config: (raw.config ?? {}) as PropertyConfig,
    order_key: raw.order_key,
  };
}

export function toRow(raw: {
  page_id: string;
  properties: Json;
  order_key: string;
  created_at: string;
  updated_at: string;
  pages: { title: string; icon: string | null } | null;
}): Row {
  return {
    pageId: raw.page_id,
    title: raw.pages?.title ?? "",
    icon: raw.pages?.icon ?? null,
    properties: (raw.properties ?? {}) as Record<string, PropertyValue>,
    orderKey: raw.order_key,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
  };
}

/**
 * Everything an inline database block needs, in one round trip group.
 * The page route fetches the same shape on the server; this is the client
 * equivalent for databases embedded inside another page's editor.
 */
export async function fetchDatabaseBundle(
  databaseId: string,
): Promise<DatabaseBundle | null> {
  const supabase = createClient();
  const [{ data: page }, { data: props }, { data: views }, { data: rawRows }] =
    await Promise.all([
      supabase
        .from("pages")
        .select("id, title, icon")
        .eq("id", databaseId)
        .is("archived_at", null)
        .maybeSingle(),
      supabase
        .from("database_properties")
        .select("id, name, type, config, order_key")
        .eq("database_id", databaseId)
        .order("order_key"),
      supabase
        .from("views")
        .select("id, name, type, config, order_key")
        .eq("database_id", databaseId)
        .order("order_key"),
      supabase
        .from("database_rows")
        .select(
          "page_id, properties, order_key, created_at, updated_at, pages!inner(title, icon, archived_at)",
        )
        .eq("database_id", databaseId)
        .is("pages.archived_at", null)
        .order("order_key"),
    ]);

  // The database page was deleted or archived out from under the block.
  if (!page) return null;

  return {
    pageId: page.id,
    title: page.title,
    icon: page.icon,
    properties: (props ?? []).map(toProperty),
    views: (views ?? []).map(
      (v): ViewRecord => ({
        id: v.id,
        name: v.name,
        type: v.type as ViewType,
        config: (v.config ?? {}) as ViewConfig,
        order_key: v.order_key,
      }),
    ),
    rows: (rawRows ?? []).map(toRow),
  };
}

export async function fetchRows(databaseId: string): Promise<Row[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("database_rows")
    .select(
      "page_id, properties, order_key, created_at, updated_at, pages!inner(title, icon, archived_at)",
    )
    .eq("database_id", databaseId)
    .is("pages.archived_at", null)
    .order("order_key");
  if (error) throw error;
  return data.map(toRow);
}

export async function createRow(
  databaseId: string,
  workspaceId: string,
  properties: Record<string, PropertyValue> = {},
  title = "",
): Promise<string> {
  const supabase = createClient();
  const { data: last } = await supabase
    .from("database_rows")
    .select("order_key")
    .eq("database_id", databaseId)
    .order("order_key", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: page, error: pageError } = await supabase
    .from("pages")
    .insert({
      workspace_id: workspaceId,
      parent_page_id: databaseId,
      title,
      order_key: keyAfter(null),
    })
    .select("id")
    .single();
  if (pageError) throw pageError;

  const { error } = await supabase.from("database_rows").insert({
    page_id: page.id,
    database_id: databaseId,
    workspace_id: workspaceId,
    properties: properties as Json,
    order_key: keyAfter(last?.order_key ?? null),
  });
  if (error) throw error;
  return page.id;
}

export async function updateRowProperties(
  pageId: string,
  merged: Record<string, PropertyValue>,
) {
  const supabase = createClient();
  const { error } = await supabase
    .from("database_rows")
    .update({ properties: merged as Json })
    .eq("page_id", pageId);
  if (error) throw error;
}

export async function addProperty(
  databaseId: string,
  workspaceId: string,
  name: string,
  type: PropertyType,
  config: PropertyConfig = {},
): Promise<Property> {
  const supabase = createClient();
  const { data: last } = await supabase
    .from("database_properties")
    .select("order_key")
    .eq("database_id", databaseId)
    .order("order_key", { ascending: false })
    .limit(1)
    .maybeSingle();
  const { data, error } = await supabase
    .from("database_properties")
    .insert({
      database_id: databaseId,
      workspace_id: workspaceId,
      name,
      type,
      config: config as Json,
      order_key: keyAfter(last?.order_key ?? null),
    })
    .select("id, name, type, config, order_key")
    .single();
  if (error) throw error;
  return toProperty(data);
}

export async function updateProperty(
  propertyId: string,
  patch: { name?: string; config?: PropertyConfig },
) {
  const supabase = createClient();
  const { error } = await supabase
    .from("database_properties")
    .update({ ...patch, config: patch.config as Json | undefined })
    .eq("id", propertyId);
  if (error) throw error;
}

export async function deleteProperty(propertyId: string) {
  const supabase = createClient();
  const { error } = await supabase
    .from("database_properties")
    .delete()
    .eq("id", propertyId);
  if (error) throw error;
}

export async function saveViewConfig(viewId: string, config: ViewConfig) {
  const supabase = createClient();
  const { error } = await supabase
    .from("views")
    .update({ config: config as Json })
    .eq("id", viewId);
  if (error) throw error;
}

export async function createView(
  databaseId: string,
  workspaceId: string,
  type: ViewType,
  name: string,
  config: ViewConfig = {},
): Promise<ViewRecord> {
  const supabase = createClient();
  const { data: last } = await supabase
    .from("views")
    .select("order_key")
    .eq("database_id", databaseId)
    .order("order_key", { ascending: false })
    .limit(1)
    .maybeSingle();
  const { data, error } = await supabase
    .from("views")
    .insert({
      database_id: databaseId,
      workspace_id: workspaceId,
      name,
      type,
      config: config as Json,
      order_key: keyAfter(last?.order_key ?? null),
    })
    .select("id, name, type, config, order_key")
    .single();
  if (error) throw error;
  return {
    id: data.id,
    name: data.name,
    type: data.type as ViewType,
    config: (data.config ?? {}) as ViewConfig,
    order_key: data.order_key,
  };
}

const DEFAULT_STATUS_OPTIONS = [
  { id: "todo", name: "To do", color: "gray" },
  { id: "in-progress", name: "In progress", color: "blue" },
  { id: "done", name: "Done", color: "green" },
];

/** Create a database page with default properties and views. */
/** Persist a dragged column's new position. */
export async function reorderProperty(propertyId: string, orderKey: string) {
  const supabase = createClient();
  const { error } = await supabase
    .from("database_properties")
    .update({ order_key: orderKey })
    .eq("id", propertyId);
  if (error) throw error;
}

export async function createDatabase(
  workspaceId: string,
  parentPageId: string | null = null,
): Promise<string> {
  const supabase = createClient();
  let siblingQuery = supabase
    .from("pages")
    .select("order_key")
    .eq("workspace_id", workspaceId)
    .is("archived_at", null);
  siblingQuery = parentPageId
    ? siblingQuery.eq("parent_page_id", parentPageId)
    : siblingQuery.is("parent_page_id", null);
  const { data: lastPage } = await siblingQuery
    .order("order_key", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: page, error: pageError } = await supabase
    .from("pages")
    .insert({
      workspace_id: workspaceId,
      parent_page_id: parentPageId,
      title: "",
      order_key: keyAfter(lastPage?.order_key ?? null),
    })
    .select("id")
    .single();
  if (pageError) throw pageError;

  const { error: dbError } = await supabase
    .from("databases")
    .insert({ page_id: page.id, workspace_id: workspaceId });
  if (dbError) throw dbError;

  const status = await addProperty(page.id, workspaceId, "Status", "select", {
    options: DEFAULT_STATUS_OPTIONS,
  });
  await addProperty(page.id, workspaceId, "Due", "date");

  await createView(page.id, workspaceId, "table", "Table");
  await createView(page.id, workspaceId, "board", "Board", { groupBy: status.id });

  return page.id;
}

/** Titles of rows in a database, for relation pickers. */
export async function fetchRelationOptions(
  databaseId: string,
): Promise<{ pageId: string; title: string }[]> {
  const rows = await fetchRows(databaseId);
  return rows.map((r) => ({ pageId: r.pageId, title: r.title || "Untitled" }));
}
