/**
 * Shared database-bundle query, used with either Supabase client.
 *
 * The page route runs it on the server so an inline database paints with the
 * page instead of after a second client round trip; the editor runs it in the
 * browser for databases inserted after load.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import type { Property, PropertyConfig, PropertyType } from "@/lib/db/model";
import type { Row } from "@/lib/db/model";

export type ViewLike = {
  id: string;
  name: string;
  type: string;
  config: Json;
  order_key: string;
};

export type DatabaseBundleData = {
  pageId: string;
  title: string;
  icon: string | null;
  properties: Property[];
  views: ViewLike[];
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

function toRowLike(raw: {
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
    properties: (raw.properties ?? {}) as Row["properties"],
    orderKey: raw.order_key,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
  };
}

export async function fetchBundleWith(
  supabase: SupabaseClient<Database>,
  databaseId: string,
): Promise<DatabaseBundleData | null> {
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

  if (!page) return null;

  return {
    pageId: page.id,
    title: page.title,
    icon: page.icon,
    properties: (props ?? []).map(toProperty),
    views: views ?? [],
    rows: (rawRows ?? []).map((r) =>
      toRowLike(r as unknown as Parameters<typeof toRowLike>[0]),
    ),
  };
}

/** A sub-page referenced by a `page` block, enough to render the link. */
export type PageRef = {
  pageId: string;
  title: string;
  icon: string | null;
  isDatabase: boolean;
};

/** Page ids referenced by `page` blocks on a page. */
export function pageIdsInBlocks(rows: { type: string; content: unknown }[]): string[] {
  const ids: string[] = [];
  for (const row of rows) {
    if (row.type !== "page") continue;
    const props = (row.content as { props?: Record<string, unknown> } | null)?.props;
    const id = props?.pageId;
    if (typeof id === "string" && id !== "") ids.push(id);
  }
  return [...new Set(ids)];
}

/**
 * Titles and icons for linked sub-pages, fetched with the page so the links
 * paint immediately. Archived or deleted targets are simply omitted; the
 * block renders a "no longer exists" note for those.
 */
export async function fetchPageRefs(
  supabase: SupabaseClient<Database>,
  pageIds: string[],
): Promise<PageRef[]> {
  if (pageIds.length === 0) return [];
  const { data } = await supabase
    .from("pages")
    .select("id, title, icon, databases(page_id)")
    .in("id", pageIds)
    .is("archived_at", null);
  return ((data ?? []) as unknown as {
    id: string;
    title: string;
    icon: string | null;
    databases: unknown;
  }[]).map((row) => ({
    pageId: row.id,
    title: row.title,
    icon: row.icon,
    isDatabase: row.databases !== null,
  }));
}

/** Database ids referenced by `database` blocks on a page. */
export function databaseIdsInBlocks(
  rows: { type: string; content: unknown }[],
): string[] {
  const ids: string[] = [];
  for (const row of rows) {
    if (row.type !== "database") continue;
    const props = (row.content as { props?: Record<string, unknown> } | null)?.props;
    const id = props?.databaseId;
    if (typeof id === "string" && id !== "") ids.push(id);
  }
  return [...new Set(ids)];
}
