/**
 * Drag-to-reorder arithmetic, shared by the sidebar tree and database
 * columns. Kept pure so the fiddly parts — dropping either side of a
 * neighbour, moving an item that is already in place, and refusing to drop a
 * page inside its own subtree — are unit-tested rather than debugged by
 * dragging things around.
 */
import { generateKeyBetween } from "@/lib/order";

export type Orderable = { id: string; order_key: string };

export type DropPosition = "before" | "after";

/**
 * The order key that puts `draggedId` on the given side of `targetId`.
 *
 * Returns null when the move is a no-op, so callers can skip the write. The
 * dragged item is removed from the sequence before neighbours are read: it is
 * leaving its old slot, so its own key must not bound the new one.
 */
export function keyForMove(
  items: Orderable[],
  draggedId: string,
  targetId: string,
  position: DropPosition,
): string | null {
  if (draggedId === targetId) return null;

  const ordered = [...items].sort((a, b) => (a.order_key < b.order_key ? -1 : 1));
  const remaining = ordered.filter((item) => item.id !== draggedId);
  const targetIndex = remaining.findIndex((item) => item.id === targetId);
  if (targetIndex === -1) return null;

  const insertAt = position === "before" ? targetIndex : targetIndex + 1;
  const before = remaining[insertAt - 1] ?? null;
  const after = remaining[insertAt] ?? null;

  // Already sitting in that slot: nothing to write.
  const currentIndex = ordered.findIndex((item) => item.id === draggedId);
  if (currentIndex !== -1) {
    const currentBefore = ordered[currentIndex - 1]?.id ?? null;
    const currentAfter = ordered[currentIndex + 1]?.id ?? null;
    if ((before?.id ?? null) === currentBefore && (after?.id ?? null) === currentAfter) {
      return null;
    }
  }

  return generateKeyBetween(before?.order_key ?? null, after?.order_key ?? null);
}

/** The order key for appending to the end of a list. */
export function keyForAppend(items: Orderable[]): string {
  const ordered = [...items].sort((a, b) => (a.order_key < b.order_key ? -1 : 1));
  const last = ordered[ordered.length - 1] ?? null;
  return generateKeyBetween(last?.order_key ?? null, null);
}

export type Parented = { id: string; parent_page_id: string | null };

/**
 * Is `candidateId` inside `rootId`'s subtree (or the root itself)?
 *
 * Dropping a page into its own descendant would detach that branch from the
 * tree entirely, so the sidebar refuses such moves.
 */
export function isWithinSubtree(
  items: Parented[],
  rootId: string,
  candidateId: string,
): boolean {
  if (rootId === candidateId) return true;
  const byId = new Map(items.map((item) => [item.id, item]));

  let current = byId.get(candidateId);
  const seen = new Set<string>();
  while (current?.parent_page_id) {
    if (seen.has(current.id)) return false; // corrupt data: stop rather than hang
    seen.add(current.id);
    if (current.parent_page_id === rootId) return true;
    current = byId.get(current.parent_page_id);
  }
  return false;
}

/**
 * Where a pointer sits over a row: the middle band nests the dragged item
 * inside the target, the outer bands place it either side.
 */
export function dropZone(
  offsetY: number,
  height: number,
  allowInside: boolean,
): DropPosition | "inside" {
  if (height <= 0) return "before";
  if (!allowInside) return offsetY < height / 2 ? "before" : "after";
  const ratio = offsetY / height;
  if (ratio < 0.3) return "before";
  if (ratio > 0.7) return "after";
  return "inside";
}
