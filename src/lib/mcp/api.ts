/**
 * Workspace operations exposed to MCP. Every call goes through a Supabase
 * client carrying the user's session, so RLS applies exactly as it does in
 * the app — the MCP server has no privileged access.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { BlockRowLike } from "@/lib/blocks/sync";
import type { Database, Json } from "@/lib/database.types";
import { normalizeDateValue } from "@/lib/db/date-value";
import { evaluateFilter, type FilterGroup } from "@/lib/db/filters";
import type { Property, PropertyConfig, PropertyType, PropertyValue, Row } from "@/lib/db/model";
import { sortRows, type Sort } from "@/lib/db/sorts";
import { blocksToMarkdown } from "@/lib/export/markdown";
import { markdownToBlocks, type ParsedBlock } from "@/lib/export/markdown-import";
import { keyAfter } from "@/lib/order";

type Client = SupabaseClient<Database>;

export async function currentWorkspaceId(supabase: Client): Promise<string> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("not signed in");
  const { data, error } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("no workspace for this user");
  return data.workspace_id;
}

export async function search(supabase: Client, query: string, limit = 20) {
  const { data, error } = await supabase.rpc("search_workspace", {
    p_query: query,
    p_limit: limit,
  });
  if (error) throw error;
  return (data ?? []).map((r) => ({
    pageId: r.page_id,
    title: r.title || "Untitled",
    icon: r.icon,
    kind: r.is_database ? "database" : r.is_row ? "row" : "page",
    snippet: r.snippet?.slice(0, 160) ?? null,
  }));
}

export async function readPage(supabase: Client, pageId: string) {
  const { data: page, error } = await supabase
    .from("pages")
    .select("id, title, icon, parent_page_id, created_at, updated_at")
    .eq("id", pageId)
    .is("archived_at", null)
    .maybeSingle();
  if (error) throw error;
  if (!page) throw new Error(`page ${pageId} not found`);

  const [{ data: blocks }, { data: children }, { data: rowRecord }, { data: dbRecord }] =
    await Promise.all([
      supabase
        .from("blocks")
        .select("id, parent_block_id, type, content, order_key")
        .eq("page_id", pageId)
        .order("order_key"),
      supabase
        .from("pages")
        .select("id, title, icon")
        .eq("parent_page_id", pageId)
        .is("archived_at", null)
        .order("order_key"),
      supabase
        .from("database_rows")
        .select("database_id, properties")
        .eq("page_id", pageId)
        .maybeSingle(),
      supabase.from("databases").select("page_id").eq("page_id", pageId).maybeSingle(),
    ]);

  let properties: Record<string, unknown> | null = null;
  if (rowRecord) {
    const propertyList = await listProperties(supabase, rowRecord.database_id);
    const byId = new Map(propertyList.map((p) => [p.id, p]));
    properties = {};
    for (const [key, value] of Object.entries((rowRecord.properties ?? {}) as Record<string, PropertyValue>)) {
      if (key.startsWith("_")) continue; // reserved sync markers
      const property = byId.get(key);
      if (property) properties[property.name] = readableValue(property, value);
    }
  }

  return {
    pageId: page.id,
    title: page.title || "Untitled",
    icon: page.icon,
    parentPageId: page.parent_page_id,
    isDatabase: Boolean(dbRecord),
    databaseId: rowRecord?.database_id ?? null,
    properties,
    markdown: blocksToMarkdown((blocks ?? []) as BlockRowLike[]),
    children: (children ?? []).map((c) => ({ pageId: c.id, title: c.title || "Untitled", icon: c.icon })),
    updatedAt: page.updated_at,
  };
}

function readableValue(property: Property, value: PropertyValue): unknown {
  if (property.type === "select" && typeof value === "string") {
    return property.config.options?.find((o) => o.id === value)?.name ?? value;
  }
  if (property.type === "multi_select" && Array.isArray(value)) {
    return value.map((id) => property.config.options?.find((o) => o.id === id)?.name ?? id);
  }
  return value;
}

export async function createPage(
  supabase: Client,
  workspaceId: string,
  args: { title: string; parentPageId?: string | null; markdown?: string; icon?: string },
) {
  let siblingQuery = supabase
    .from("pages")
    .select("order_key")
    .eq("workspace_id", workspaceId)
    .is("archived_at", null);
  siblingQuery = args.parentPageId
    ? siblingQuery.eq("parent_page_id", args.parentPageId)
    : siblingQuery.is("parent_page_id", null);
  const { data: last } = await siblingQuery
    .order("order_key", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: page, error } = await supabase
    .from("pages")
    .insert({
      workspace_id: workspaceId,
      parent_page_id: args.parentPageId ?? null,
      title: args.title,
      icon: args.icon ?? null,
      order_key: keyAfter(last?.order_key ?? null),
    })
    .select("id")
    .single();
  if (error) throw error;

  if (args.markdown) {
    await appendBlocks(supabase, workspaceId, page.id, args.markdown);
  }
  return { pageId: page.id };
}

/** Append markdown to the end of a page, as real blocks. */
export async function appendBlocks(
  supabase: Client,
  workspaceId: string,
  pageId: string,
  markdown: string,
) {
  const { data: last } = await supabase
    .from("blocks")
    .select("order_key")
    .eq("page_id", pageId)
    .is("parent_block_id", null)
    .order("order_key", { ascending: false })
    .limit(1)
    .maybeSingle();

  const parsed = markdownToBlocks(markdown);
  const rows: Database["public"]["Tables"]["blocks"]["Insert"][] = [];
  let rootKey: string | null = last?.order_key ?? null;

  const walk = (blocks: ParsedBlock[], parentId: string | null) => {
    let key: string | null = null;
    for (const block of blocks) {
      const id = crypto.randomUUID();
      if (parentId === null) {
        rootKey = keyAfter(rootKey);
        key = rootKey;
      } else {
        key = keyAfter(key);
      }
      rows.push({
        id,
        workspace_id: workspaceId,
        page_id: pageId,
        parent_block_id: parentId,
        type: block.type,
        content: { props: block.props, content: block.content } as unknown as Json,
        order_key: key,
      });
      if (block.children.length > 0) walk(block.children, id);
    }
  };
  walk(parsed, null);

  if (rows.length > 0) {
    const { error } = await supabase.from("blocks").insert(rows);
    if (error) throw error;
  }
  return { blocksAdded: rows.length };
}

export async function listDatabases(supabase: Client, workspaceId: string) {
  const { data, error } = await supabase
    .from("databases")
    .select("page_id, pages!databases_page_id_fkey(title, icon), database_properties(id, name, type, config, order_key)")
    .eq("workspace_id", workspaceId);
  if (error) throw error;
  return (data ?? []).map((d) => {
    const page = d.pages as unknown as { title: string; icon: string | null };
    return {
      databaseId: d.page_id,
      title: page.title || "Untitled",
      icon: page.icon,
      properties: (d.database_properties ?? [])
        .sort((a, b) => (a.order_key < b.order_key ? -1 : 1))
        .map((p) => ({
          id: p.id,
          name: p.name,
          type: p.type,
          options: ((p.config ?? {}) as PropertyConfig).options?.map((o) => o.name),
        })),
    };
  });
}

export async function listProperties(supabase: Client, databaseId: string): Promise<Property[]> {
  const { data, error } = await supabase
    .from("database_properties")
    .select("id, name, type, config, order_key")
    .eq("database_id", databaseId)
    .order("order_key");
  if (error) throw error;
  return (data ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    type: p.type as PropertyType,
    config: (p.config ?? {}) as PropertyConfig,
    order_key: p.order_key,
  }));
}

async function fetchDatabaseRows(supabase: Client, databaseId: string): Promise<Row[]> {
  const { data, error } = await supabase
    .from("database_rows")
    .select("page_id, properties, order_key, created_at, updated_at, pages!inner(title, icon, archived_at)")
    .eq("database_id", databaseId)
    .is("pages.archived_at", null)
    .order("order_key");
  if (error) throw error;
  return (data ?? []).map((r) => {
    const page = r.pages as unknown as { title: string; icon: string | null };
    return {
      pageId: r.page_id,
      title: page.title,
      icon: page.icon,
      properties: (r.properties ?? {}) as Record<string, PropertyValue>,
      orderKey: r.order_key,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  });
}

/**
 * Resolve a property reference (id or name) and coerce a human-friendly value
 * (option names, "true"/"false") into the stored representation.
 */
export function resolveProperty(properties: Property[], reference: string): Property | undefined {
  return (
    properties.find((p) => p.id === reference) ??
    properties.find((p) => p.name.toLowerCase() === reference.toLowerCase())
  );
}

export function coerceValue(property: Property, value: unknown): PropertyValue {
  switch (property.type) {
    case "select": {
      if (typeof value !== "string") return null;
      const option = property.config.options?.find(
        (o) => o.id === value || o.name.toLowerCase() === value.toLowerCase(),
      );
      return option?.id ?? value;
    }
    case "multi_select":
    case "relation": {
      const list = Array.isArray(value) ? value : value === null || value === undefined ? [] : [value];
      return list.map((item) => {
        if (typeof item !== "string") return String(item);
        const option = property.config.options?.find(
          (o) => o.id === item || o.name.toLowerCase() === item.toLowerCase(),
        );
        return option?.id ?? item;
      });
    }
    case "number":
      return value === null || value === "" ? null : Number(value);
    case "checkbox":
      return value === true || value === "true";
    case "date":
      // preserves a time when the agent supplies one
      return normalizeDateValue(value);
    default:
      return value === null || value === undefined ? null : String(value);
  }
}

export async function queryDatabase(
  supabase: Client,
  databaseId: string,
  args: { filter?: FilterGroup; sorts?: Sort[]; limit?: number } = {},
) {
  const properties = await listProperties(supabase, databaseId);
  const byId = new Map(properties.map((p) => [p.id, p]));
  const rows = await fetchDatabaseRows(supabase, databaseId);

  const filtered = args.filter
    ? rows.filter((row) => evaluateFilter(row, normalizeFilter(args.filter!, properties), byId))
    : rows;
  const sorted = args.sorts?.length
    ? sortRows(filtered, normalizeSorts(args.sorts, properties), byId)
    : filtered;
  const limited = args.limit ? sorted.slice(0, args.limit) : sorted;

  return limited.map((row) => ({
    pageId: row.pageId,
    title: row.title || "Untitled",
    properties: Object.fromEntries(
      properties
        .filter((p) => row.properties[p.id] !== undefined)
        .map((p) => [p.name, readableValue(p, row.properties[p.id])]),
    ),
    updatedAt: row.updatedAt,
  }));
}

/** Let agents filter/sort by property name as well as id. */
function normalizeFilter(filter: FilterGroup, properties: Property[]): FilterGroup {
  return {
    combinator: filter.combinator,
    conditions: filter.conditions.map((condition) => {
      if ("combinator" in condition) return normalizeFilter(condition, properties);
      if (condition.property === "title") return condition;
      const property = resolveProperty(properties, condition.property);
      if (!property) return condition;
      return {
        ...condition,
        property: property.id,
        value:
          condition.value === undefined
            ? undefined
            : coerceComparisonValue(property, condition.value),
      };
    }),
  };
}

function coerceComparisonValue(property: Property, value: unknown): unknown {
  if (property.type === "multi_select" || property.type === "relation") {
    const coerced = coerceValue(property, value);
    return Array.isArray(coerced) ? coerced[0] : coerced;
  }
  return coerceValue(property, value);
}

function normalizeSorts(sorts: Sort[], properties: Property[]): Sort[] {
  return sorts.map((sort) =>
    sort.property === "title"
      ? sort
      : { ...sort, property: resolveProperty(properties, sort.property)?.id ?? sort.property },
  );
}

export async function createRow(
  supabase: Client,
  workspaceId: string,
  databaseId: string,
  args: { title: string; properties?: Record<string, unknown>; markdown?: string },
) {
  const properties = await listProperties(supabase, databaseId);
  const stored: Record<string, PropertyValue> = {};
  for (const [key, value] of Object.entries(args.properties ?? {})) {
    const property = resolveProperty(properties, key);
    if (!property) continue;
    stored[property.id] = coerceValue(property, value);
  }

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
      title: args.title,
      order_key: keyAfter(null),
    })
    .select("id")
    .single();
  if (pageError) throw pageError;

  const { error } = await supabase.from("database_rows").insert({
    page_id: page.id,
    database_id: databaseId,
    workspace_id: workspaceId,
    properties: stored as Json,
    order_key: keyAfter(last?.order_key ?? null),
  });
  if (error) throw error;

  if (args.markdown) await appendBlocks(supabase, workspaceId, page.id, args.markdown);
  return { pageId: page.id };
}

export async function updateRowProperties(
  supabase: Client,
  pageId: string,
  updates: Record<string, unknown>,
  title?: string,
) {
  const { data: record, error: recordError } = await supabase
    .from("database_rows")
    .select("database_id, properties")
    .eq("page_id", pageId)
    .maybeSingle();
  if (recordError) throw recordError;
  if (!record) throw new Error(`page ${pageId} is not a database row`);

  const properties = await listProperties(supabase, record.database_id);
  const merged = { ...((record.properties ?? {}) as Record<string, PropertyValue>) };
  const applied: string[] = [];

  for (const [key, value] of Object.entries(updates)) {
    const property = resolveProperty(properties, key);
    if (!property) continue;
    merged[property.id] = coerceValue(property, value);
    applied.push(property.name);
  }

  const { error } = await supabase
    .from("database_rows")
    .update({ properties: merged as Json })
    .eq("page_id", pageId);
  if (error) throw error;

  if (title !== undefined) {
    const { error: titleError } = await supabase
      .from("pages")
      .update({ title })
      .eq("id", pageId);
    if (titleError) throw titleError;
  }

  return { updated: applied, titleChanged: title !== undefined };
}
