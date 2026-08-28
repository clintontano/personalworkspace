import { generateKeyBetween } from "fractional-indexing";

export { generateKeyBetween };

/**
 * Assign fractional order keys to a sibling list in its new order.
 *
 * Keeps an item's existing key whenever it is still strictly greater than the
 * previous resolved key (so unchanged items are not rewritten); otherwise
 * generates a key between the previous resolved key and the next reusable
 * existing key. Returns only the keys that changed.
 */
export function assignSiblingKeys(
  orderedIds: string[],
  existingKeys: Map<string, string>,
): Map<string, string> {
  // Keep the longest increasing subsequence of existing keys (those blocks
  // stay untouched) and generate keys for everything else.
  const keyed = orderedIds
    .map((id, index) => ({ id, index, key: existingKeys.get(id) }))
    .filter((x): x is { id: string; index: number; key: string } => x.key !== undefined);

  // O(n^2) LIS over keys; sibling lists are small.
  const lisPrev = new Array<number>(keyed.length).fill(-1);
  const lisLen = new Array<number>(keyed.length).fill(1);
  let best = -1;
  for (let i = 0; i < keyed.length; i++) {
    for (let j = 0; j < i; j++) {
      if (keyed[j].key < keyed[i].key && lisLen[j] + 1 > lisLen[i]) {
        lisLen[i] = lisLen[j] + 1;
        lisPrev[i] = j;
      }
    }
    if (best === -1 || lisLen[i] > lisLen[best]) best = i;
  }
  const keep = new Set<string>();
  for (let i = best; i !== -1; i = lisPrev[i]) keep.add(keyed[i].id);

  const changed = new Map<string, string>();
  let prev: string | null = null;
  for (let i = 0; i < orderedIds.length; i++) {
    const id = orderedIds[i];
    if (keep.has(id)) {
      prev = existingKeys.get(id)!;
      continue;
    }
    let next: string | null = null;
    for (let j = i + 1; j < orderedIds.length; j++) {
      if (keep.has(orderedIds[j])) {
        next = existingKeys.get(orderedIds[j])!;
        break;
      }
    }
    const key = generateKeyBetween(prev, next);
    changed.set(id, key);
    prev = key;
  }

  return changed;
}

/** Key for appending at the end of a sibling list. */
export function keyAfter(lastKey: string | null): string {
  return generateKeyBetween(lastKey, null);
}
