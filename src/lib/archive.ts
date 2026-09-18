/**
 * Archiving and un-archiving pages, as a subtree.
 *
 * Archiving is the reversible delete: `archived_at` is set and every read path
 * filters on it. It has to move the whole subtree, because the sidebar builds
 * its tree from `parent_page_id` over the non-archived pages only — a child
 * left behind is keyed under a parent that is never rendered, so it disappears
 * from the tree while still being returned by search. Database rows are pages
 * parented to the database page, so a database's rows come along with it.
 *
 * Shared by the app's delete button and the MCP delete tools rather than
 * implemented twice.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

type Client = SupabaseClient<Database>;

export type SubtreeNode = {
  pageId: string;
  title: string;
  parentPageId: string | null;
  archivedAt: string | null;
};

/**
 * A page and every descendant, the root first. Archived pages are included:
 * restoring needs them, and archiving skips them by timestamp.
 */
export async function collectSubtree(supabase: Client, rootId: string): Promise<SubtreeNode[]> {
  const { data: root, error } = await supabase
    .from("pages")
    .select("id, title, parent_page_id, archived_at")
    .eq("id", rootId)
    .maybeSingle();
  if (error) throw error;
  if (!root) throw new Error(`page ${rootId} not found`);

  const nodes: SubtreeNode[] = [toNode(root)];
  const seen = new Set<string>([root.id]);
  let frontier = [root.id];

  // One query per level rather than one per page.
  while (frontier.length > 0) {
    const { data, error: childError } = await supabase
      .from("pages")
      .select("id, title, parent_page_id, archived_at")
      .in("parent_page_id", frontier)
      .order("order_key");
    if (childError) throw childError;

    frontier = [];
    for (const child of data ?? []) {
      // A cycle should be impossible (`isWithinSubtree` refuses to create one)
      // but it would spin here forever, and the guard is one Set.
      if (seen.has(child.id)) continue;
      seen.add(child.id);
      nodes.push(toNode(child));
      frontier.push(child.id);
    }
  }

  return nodes;
}

function toNode(row: {
  id: string;
  title: string;
  parent_page_id: string | null;
  archived_at: string | null;
}): SubtreeNode {
  return {
    pageId: row.id,
    title: row.title || "Untitled",
    parentPageId: row.parent_page_id,
    archivedAt: row.archived_at,
  };
}

export type ArchiveResult = {
  pageId: string;
  title: string;
  /** Titles of the pages this archived, the target first. */
  archived: string[];
  /** True when the target was already archived and nothing changed. */
  alreadyArchived: boolean;
};

/**
 * Archive a page and its descendants under one timestamp, which is what makes
 * the matching restore able to tell them apart from pages archived earlier on
 * their own.
 */
export async function archiveSubtree(supabase: Client, pageId: string): Promise<ArchiveResult> {
  const subtree = await collectSubtree(supabase, pageId);
  const root = subtree[0];
  const pending = subtree.filter((node) => node.archivedAt === null);

  if (pending.length === 0) {
    return { pageId, title: root.title, archived: [], alreadyArchived: true };
  }

  // Reusing the root's own timestamp when it is already archived keeps a later
  // restore able to take these with it — this is the repair path for a subtree
  // archived before archiving moved the whole thing.
  const { data, error } = await supabase
    .from("pages")
    .update({ archived_at: root.archivedAt ?? new Date().toISOString() })
    .in(
      "id",
      pending.map((node) => node.pageId),
    )
    .is("archived_at", null)
    .select("id");
  if (error) throw error;

  // RLS refuses a forbidden write by matching zero rows rather than raising,
  // so silence here means nothing happened.
  const changed = new Set((data ?? []).map((row) => row.id));
  if (root.archivedAt === null && !changed.has(pageId)) {
    throw new Error(`not allowed to archive page ${pageId}`);
  }

  return {
    pageId,
    title: root.title,
    archived: pending.filter((node) => changed.has(node.pageId)).map((node) => node.title),
    alreadyArchived: false,
  };
}

export type RestoreResult = {
  pageId: string;
  title: string;
  restoredCount: number;
  restored: string[];
  alreadyActive: boolean;
  /** Set when the restored page sits under an ancestor that is still archived. */
  hiddenUnder: string | null;
};

/** Un-archive a page and the descendants archived in the same operation. */
export async function restoreSubtree(supabase: Client, pageId: string): Promise<RestoreResult> {
  const subtree = await collectSubtree(supabase, pageId);
  const root = subtree[0];

  if (root.archivedAt === null) {
    return {
      pageId,
      title: root.title,
      restoredCount: 0,
      restored: [],
      alreadyActive: true,
      hiddenUnder: null,
    };
  }

  // Only the pages archived alongside this one carry its exact timestamp, so a
  // page archived separately before it stays archived.
  const together = subtree.filter((node) => node.archivedAt === root.archivedAt);

  const { data, error } = await supabase
    .from("pages")
    .update({ archived_at: null })
    .in(
      "id",
      together.map((node) => node.pageId),
    )
    .select("id");
  if (error) throw error;

  const changed = new Set((data ?? []).map((row) => row.id));
  if (!changed.has(pageId)) throw new Error(`not allowed to restore page ${pageId}`);

  const titles = together
    .filter((node) => changed.has(node.pageId))
    .map((node) => node.title);
  return {
    pageId,
    title: root.title,
    restoredCount: titles.length,
    restored: titles.slice(0, 20),
    alreadyActive: false,
    hiddenUnder: await archivedAncestorTitle(supabase, root.parentPageId),
  };
}

/**
 * The nearest still-archived ancestor, if any. A page restored under one is
 * reachable by URL but absent from the sidebar, which is worth saying out loud
 * rather than leaving the caller to wonder where it went.
 */
async function archivedAncestorTitle(
  supabase: Client,
  parentPageId: string | null,
): Promise<string | null> {
  let current = parentPageId;
  const seen = new Set<string>();
  while (current && !seen.has(current)) {
    seen.add(current);
    const { data } = await supabase
      .from("pages")
      .select("title, parent_page_id, archived_at")
      .eq("id", current)
      .maybeSingle();
    if (!data) return null;
    if (data.archived_at !== null) return data.title || "Untitled";
    current = data.parent_page_id;
  }
  return null;
}
