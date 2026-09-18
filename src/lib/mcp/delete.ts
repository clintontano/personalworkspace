/**
 * Destructive workspace operations exposed to MCP.
 *
 * Two rules shape everything here. Deleting a page is reversible by default —
 * it archives, the same as the app's own delete button — because an agent
 * acting on a misread instruction should not be able to destroy a page tree.
 * And every write is verified: RLS refuses a forbidden delete or update by
 * matching zero rows rather than raising, so an unchecked call cannot tell
 * "done" from "refused".
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { archiveSubtree, collectSubtree, restoreSubtree } from "@/lib/archive";
import type { Database, Json } from "@/lib/database.types";
import type { PropertyValue } from "@/lib/db/model";
import { pruneViewsOfProperty } from "@/lib/db/view-config";
import { listProperties, resolveProperty } from "@/lib/mcp/api";

type Client = SupabaseClient<Database>;

export { restoreSubtree as restorePage };

export type DeletePageResult = {
  pageId: string;
  title: string;
  mode: "archived" | "deleted";
  /** How many pages this took, the target included. */
  pageCount: number;
  /** Their titles, the target first, capped so a large database stays readable. */
  pages: string[];
  alreadyArchived?: boolean;
  relationsCleared?: number;
};

// Enough to see what went; a database with hundreds of rows should not fill the
// response with their titles.
const TITLE_SAMPLE = 20;

function sample(titles: string[]): string[] {
  return titles.length <= TITLE_SAMPLE
    ? titles
    : [...titles.slice(0, TITLE_SAMPLE), `…and ${titles.length - TITLE_SAMPLE} more`];
}

/**
 * Archive a page, or delete it outright with `permanent`.
 *
 * Works for any page, which covers ordinary pages, database pages and database
 * rows alike — a row is a page, and a database's rows are its children, so a
 * database goes with its contents either way.
 */
export async function deletePage(
  supabase: Client,
  pageId: string,
  options: { permanent?: boolean } = {},
): Promise<DeletePageResult> {
  if (!options.permanent) {
    const result = await archiveSubtree(supabase, pageId);
    return {
      pageId,
      title: result.title,
      mode: "archived",
      pageCount: result.archived.length,
      pages: sample(result.archived),
      alreadyArchived: result.alreadyArchived,
    };
  }

  const subtree = await collectSubtree(supabase, pageId);
  const ids = subtree.map((node) => node.pageId);

  // Relations are page-id arrays inside the row properties jsonb, with no
  // foreign key to clean them up, so they are pruned here while the ids are
  // still known.
  const relationsCleared = await clearRelationsTo(supabase, ids);

  const { data, error } = await supabase.from("pages").delete().in("id", ids).select("id");
  if (error) throw error;
  if (!(data ?? []).some((row) => row.id === pageId)) {
    throw new Error(`not allowed to delete page ${pageId}`);
  }

  const titles = subtree.map((node) => node.title);
  return {
    pageId,
    title: subtree[0].title,
    mode: "deleted",
    pageCount: titles.length,
    pages: sample(titles),
    relationsCleared,
  };
}

/**
 * Drop references to deleted pages out of every relation value.
 *
 * Only rows that actually point at one of them are written, which keeps the
 * `row_updated` automation events this produces honest: each of those rows did
 * lose a relation.
 */
async function clearRelationsTo(supabase: Client, deletedIds: string[]): Promise<number> {
  const { data: relations, error } = await supabase
    .from("database_properties")
    .select("id, database_id")
    .eq("type", "relation");
  if (error) throw error;
  if ((relations ?? []).length === 0) return 0;

  const byDatabase = new Map<string, string[]>();
  for (const relation of relations ?? []) {
    byDatabase.set(relation.database_id, [
      ...(byDatabase.get(relation.database_id) ?? []),
      relation.id,
    ]);
  }

  const gone = new Set(deletedIds);
  let cleared = 0;

  for (const [databaseId, propertyIds] of byDatabase) {
    const { data: rows, error: rowError } = await supabase
      .from("database_rows")
      .select("page_id, properties")
      .eq("database_id", databaseId);
    if (rowError) throw rowError;

    for (const row of rows ?? []) {
      if (gone.has(row.page_id)) continue; // going away itself
      const properties = { ...((row.properties ?? {}) as Record<string, PropertyValue>) };
      let changed = false;

      for (const propertyId of propertyIds) {
        const value = properties[propertyId];
        if (!Array.isArray(value)) continue;
        const kept = value.filter((id) => typeof id !== "string" || !gone.has(id));
        if (kept.length !== value.length) {
          properties[propertyId] = kept;
          changed = true;
        }
      }

      if (!changed) continue;
      const { error: updateError } = await supabase
        .from("database_rows")
        .update({ properties: properties as Json })
        .eq("page_id", row.page_id);
      if (updateError) throw updateError;
      cleared += 1;
    }
  }

  return cleared;
}

export type ClearCellsResult = {
  pageId: string;
  cleared: string[];
  alreadyEmpty: string[];
};

/**
 * Clear cells on a database row: the named property values are removed, the row
 * itself stays.
 *
 * The key is deleted rather than set to null — `isEmptyValue` treats the two
 * alike, so an absent key is the tidier of the two. Reserved `_` keys (the
 * Google Calendar link) are unreachable here because only real properties
 * resolve by name.
 */
export async function clearRowValues(
  supabase: Client,
  pageId: string,
  propertyRefs: string[],
): Promise<ClearCellsResult> {
  const { data: record, error } = await supabase
    .from("database_rows")
    .select("database_id, properties")
    .eq("page_id", pageId)
    .maybeSingle();
  if (error) throw error;
  if (!record) throw new Error(`page ${pageId} is not a database row`);

  const properties = await listProperties(supabase, record.database_id);
  const stored = { ...((record.properties ?? {}) as Record<string, PropertyValue>) };
  const cleared: string[] = [];
  const alreadyEmpty: string[] = [];

  for (const reference of propertyRefs) {
    const property = resolveProperty(properties, reference);
    // A typo that silently cleared nothing would look like success, so it is
    // an error rather than a no-op.
    if (!property) {
      throw new Error(
        `no property "${reference}" in this database (have: ${properties.map((p) => p.name).join(", ")})`,
      );
    }
    if (property.id in stored) {
      delete stored[property.id];
      cleared.push(property.name);
    } else {
      alreadyEmpty.push(property.name);
    }
  }

  // No write when there is nothing to change: every write to a row enqueues an
  // automation event.
  if (cleared.length === 0) return { pageId, cleared, alreadyEmpty };

  const { data: updated, error: updateError } = await supabase
    .from("database_rows")
    .update({ properties: stored as Json })
    .eq("page_id", pageId)
    .select("page_id");
  if (updateError) throw updateError;
  if ((updated ?? []).length === 0) throw new Error(`not allowed to update row ${pageId}`);

  return { pageId, cleared, alreadyEmpty };
}

export type DeletePropertyResult = {
  databaseId: string;
  property: string;
  viewsUpdated: number;
};

/**
 * Delete a property (a column) from a database, along with its references in
 * that database's views.
 *
 * The values themselves stay behind in each row's properties jsonb, where
 * nothing reads them: rewriting every row to strip one key would enqueue an
 * automation event per row, and a re-created property gets a fresh id, so the
 * old values can never resurface.
 */
export async function deleteDatabaseProperty(
  supabase: Client,
  databaseId: string,
  propertyRef: string,
): Promise<DeletePropertyResult> {
  const properties = await listProperties(supabase, databaseId);
  const property = resolveProperty(properties, propertyRef);
  if (!property) {
    throw new Error(
      `no property "${propertyRef}" in database ${databaseId} (have: ${properties.map((p) => p.name).join(", ")})`,
    );
  }

  // Pruned first, so there is never a moment where a view filters on a
  // property that no longer exists.
  const viewsUpdated = await pruneViewsOfProperty(supabase, databaseId, property.id);

  const { data, error } = await supabase
    .from("database_properties")
    .delete()
    .eq("id", property.id)
    .select("id");
  if (error) throw error;
  if ((data ?? []).length === 0) {
    throw new Error(`not allowed to delete property "${property.name}"`);
  }

  return { databaseId, property: property.name, viewsUpdated };
}

export type DeleteBlocksResult = {
  pageId: string;
  removed: number;
};

/**
 * Delete content blocks from a page. Child blocks go with their parent.
 *
 * Ids are scoped to the page they are claimed to be on, so a stale id from
 * somewhere else cannot delete a block out of an unrelated page.
 */
export async function deleteBlocks(
  supabase: Client,
  pageId: string,
  options: { blockIds?: string[]; all?: boolean },
): Promise<DeleteBlocksResult> {
  const { data: page, error: pageError } = await supabase
    .from("pages")
    .select("id")
    .eq("id", pageId)
    .is("archived_at", null)
    .maybeSingle();
  if (pageError) throw pageError;
  if (!page) throw new Error(`page ${pageId} not found`);

  const wantsAll = options.all === true;
  const ids = options.blockIds ?? [];
  if (wantsAll && ids.length > 0) {
    throw new Error("pass block_ids or all: true, not both");
  }
  if (!wantsAll && ids.length === 0) {
    throw new Error("pass block_ids, or all: true to empty the page");
  }

  let query = supabase.from("blocks").select("id").eq("page_id", pageId);
  if (!wantsAll) query = query.in("id", ids);
  const { data: matched, error: matchError } = await query;
  if (matchError) throw matchError;
  if ((matched ?? []).length === 0) {
    // An empty page is nothing to do; ids that match nothing are a mistake
    // worth reporting rather than a silent success.
    if (wantsAll) return { pageId, removed: 0 };
    throw new Error(`none of those blocks are on page ${pageId}`);
  }

  const matchedIds = (matched ?? []).map((block) => block.id);
  const { data, error } = await supabase
    .from("blocks")
    .delete()
    .eq("page_id", pageId)
    .in("id", matchedIds)
    .select("id");
  if (error) throw error;
  if ((data ?? []).length === 0) {
    throw new Error(`not allowed to delete blocks on page ${pageId}`);
  }

  return { pageId, removed: (data ?? []).length };
}

export type TrashEntry = {
  pageId: string;
  title: string;
  kind: "page" | "database" | "row";
  archivedAt: string | null;
  /** True when the parent is not archived, so this is what a restore targets. */
  isRoot: boolean;
};

/** Archived pages, newest first, so a restore has something to aim at. */
export async function listArchivedPages(
  supabase: Client,
  workspaceId: string,
  limit = 50,
): Promise<TrashEntry[]> {
  const { data, error } = await supabase
    .from("pages")
    .select(
      "id, title, parent_page_id, archived_at, databases(page_id), database_rows!database_rows_page_id_fkey(database_id)",
    )
    .eq("workspace_id", workspaceId)
    .not("archived_at", "is", null)
    .order("archived_at", { ascending: false })
    .limit(limit);
  if (error) throw error;

  const archived = new Set((data ?? []).map((page) => page.id));
  return (data ?? []).map((page) => ({
    pageId: page.id,
    title: page.title || "Untitled",
    kind: page.databases !== null ? "database" : page.database_rows !== null ? "row" : "page",
    archivedAt: page.archived_at,
    isRoot: page.parent_page_id === null || !archived.has(page.parent_page_id),
  }));
}
