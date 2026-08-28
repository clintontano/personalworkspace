/**
 * Mapping between BlockNote's document tree and per-row block storage.
 *
 * A block row stores { type, content: { props, content }, parent_block_id,
 * order_key }. diffBlocks computes the minimal set of writes to bring the
 * stored rows in line with the editor document after an edit.
 */
import { assignSiblingKeys } from "@/lib/order";

export type BlockRowLike = {
  id: string;
  parent_block_id: string | null;
  type: string;
  content: unknown;
  order_key: string;
};

export type EditorBlockLike = {
  id: string;
  type: string;
  props?: Record<string, unknown>;
  content?: unknown;
  children?: EditorBlockLike[];
};

type FlatBlock = {
  id: string;
  parentId: string | null;
  type: string;
  content: { props: Record<string, unknown>; content: unknown };
};

export type BlockOps = {
  upserts: {
    id: string;
    parent_block_id: string | null;
    type: string;
    content: { props: Record<string, unknown>; content: unknown };
    order_key: string;
  }[];
  deleteIds: string[];
};

export function flattenDocument(
  doc: EditorBlockLike[],
  parentId: string | null = null,
  out: FlatBlock[] = [],
): FlatBlock[] {
  for (const block of doc) {
    out.push({
      id: block.id,
      parentId,
      type: block.type,
      content: { props: block.props ?? {}, content: block.content ?? [] },
    });
    if (block.children?.length) {
      flattenDocument(block.children, block.id, out);
    }
  }
  return out;
}

/** Build BlockNote partial blocks from stored rows. */
export function rowsToDocument(rows: BlockRowLike[]): EditorBlockLike[] {
  const byParent = new Map<string | null, BlockRowLike[]>();
  for (const row of rows) {
    const list = byParent.get(row.parent_block_id) ?? [];
    list.push(row);
    byParent.set(row.parent_block_id, list);
  }
  for (const list of byParent.values()) {
    list.sort((a, b) => (a.order_key < b.order_key ? -1 : a.order_key > b.order_key ? 1 : 0));
  }

  const build = (parentId: string | null): EditorBlockLike[] =>
    (byParent.get(parentId) ?? []).map((row) => {
      const content = (row.content ?? {}) as {
        props?: Record<string, unknown>;
        content?: unknown;
      };
      return {
        id: row.id,
        type: row.type,
        props: content.props ?? {},
        content: content.content ?? [],
        children: build(row.id),
      };
    });

  return build(null);
}

export function diffBlocks(prevRows: BlockRowLike[], doc: EditorBlockLike[]): BlockOps {
  const prevById = new Map(prevRows.map((r) => [r.id, r]));
  const next = flattenDocument(doc);
  const nextIds = new Set(next.map((b) => b.id));

  const deleteIds = prevRows.filter((r) => !nextIds.has(r.id)).map((r) => r.id);

  // Group new order by parent and resolve order keys per sibling list.
  const siblingOrder = new Map<string | null, string[]>();
  for (const block of next) {
    const list = siblingOrder.get(block.parentId) ?? [];
    list.push(block.id);
    siblingOrder.set(block.parentId, list);
  }

  const keyChanges = new Map<string, string>();
  for (const [parentId, orderedIds] of siblingOrder) {
    // Existing keys only count when the block was already under this parent.
    const existingKeys = new Map<string, string>();
    for (const id of orderedIds) {
      const prev = prevById.get(id);
      if (prev && prev.parent_block_id === parentId) {
        existingKeys.set(id, prev.order_key);
      }
    }
    for (const [id, key] of assignSiblingKeys(orderedIds, existingKeys)) {
      keyChanges.set(id, key);
    }
  }

  const upserts: BlockOps["upserts"] = [];
  for (const block of next) {
    const prev = prevById.get(block.id);
    const orderKey = keyChanges.get(block.id) ?? prev?.order_key;
    if (orderKey === undefined) {
      throw new Error(`No order key resolved for block ${block.id}`);
    }
    const changed =
      !prev ||
      prev.parent_block_id !== block.parentId ||
      prev.type !== block.type ||
      keyChanges.has(block.id) ||
      JSON.stringify(prev.content) !== JSON.stringify(block.content);
    if (changed) {
      upserts.push({
        id: block.id,
        parent_block_id: block.parentId,
        type: block.type,
        content: block.content,
        order_key: orderKey,
      });
    }
  }

  return { upserts, deleteIds };
}
