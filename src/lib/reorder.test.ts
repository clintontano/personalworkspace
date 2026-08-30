import { describe, expect, it } from "vitest";
import {
  dropZone,
  isWithinSubtree,
  keyForAppend,
  keyForMove,
  type Orderable,
} from "./reorder";

const list = (...keys: string[]): Orderable[] =>
  keys.map((key, i) => ({ id: `i${i}`, order_key: key }));

/** Ids in stored order, after applying a move. */
function applyMove(
  items: Orderable[],
  draggedId: string,
  targetId: string,
  position: "before" | "after",
): string[] {
  const key = keyForMove(items, draggedId, targetId, position);
  const next = items.map((item) =>
    item.id === draggedId && key ? { ...item, order_key: key } : item,
  );
  return next.sort((a, b) => (a.order_key < b.order_key ? -1 : 1)).map((i) => i.id);
}

describe("keyForMove", () => {
  const items = list("a0", "a1", "a2", "a3"); // i0 i1 i2 i3

  it("moves an item to the front", () => {
    expect(applyMove(items, "i2", "i0", "before")).toEqual(["i2", "i0", "i1", "i3"]);
  });

  it("moves an item to the end", () => {
    expect(applyMove(items, "i0", "i3", "after")).toEqual(["i1", "i2", "i3", "i0"]);
  });

  it("moves an item into the middle", () => {
    expect(applyMove(items, "i3", "i1", "after")).toEqual(["i0", "i1", "i3", "i2"]);
  });

  it("moves backwards as well as forwards", () => {
    expect(applyMove(items, "i3", "i1", "before")).toEqual(["i0", "i3", "i1", "i2"]);
  });

  it("excludes the dragged item when reading neighbours", () => {
    // dropping i1 after i2 must land between i2 and i3, not reuse i1's own key
    const key = keyForMove(items, "i1", "i2", "after")!;
    expect(key > "a2").toBe(true);
    expect(key < "a3").toBe(true);
  });

  it("is a no-op when dropped on itself", () => {
    expect(keyForMove(items, "i1", "i1", "before")).toBeNull();
    expect(keyForMove(items, "i1", "i1", "after")).toBeNull();
  });

  it("is a no-op when the item is already in that slot", () => {
    // i1 is already directly after i0 and before i2
    expect(keyForMove(items, "i1", "i0", "after")).toBeNull();
    expect(keyForMove(items, "i1", "i2", "before")).toBeNull();
  });

  it("returns null for an unknown target", () => {
    expect(keyForMove(items, "i0", "nope", "before")).toBeNull();
  });

  it("handles a single-item list", () => {
    expect(keyForMove(list("a0"), "i0", "i0", "before")).toBeNull();
  });

  it("sorts by key, not array position", () => {
    const scrambled: Orderable[] = [
      { id: "c", order_key: "a3" },
      { id: "a", order_key: "a1" },
      { id: "b", order_key: "a2" },
    ];
    const key = keyForMove(scrambled, "c", "a", "before")!;
    expect(key < "a1").toBe(true);
  });
});

describe("keyForAppend", () => {
  it("produces a key after everything else", () => {
    const key = keyForAppend(list("a0", "a1", "a2"));
    expect(key > "a2").toBe(true);
  });

  it("works on an empty list", () => {
    expect(typeof keyForAppend([])).toBe("string");
  });
});

describe("isWithinSubtree", () => {
  const tree = [
    { id: "root", parent_page_id: null },
    { id: "child", parent_page_id: "root" },
    { id: "grandchild", parent_page_id: "child" },
    { id: "other", parent_page_id: null },
  ];

  it("treats a node as within itself", () => {
    expect(isWithinSubtree(tree, "root", "root")).toBe(true);
  });

  it("finds direct and indirect descendants", () => {
    expect(isWithinSubtree(tree, "root", "child")).toBe(true);
    expect(isWithinSubtree(tree, "root", "grandchild")).toBe(true);
  });

  it("rejects unrelated nodes and ancestors", () => {
    expect(isWithinSubtree(tree, "root", "other")).toBe(false);
    expect(isWithinSubtree(tree, "child", "root")).toBe(false);
  });

  it("does not hang on a cycle in stored data", () => {
    const cyclic = [
      { id: "a", parent_page_id: "b" },
      { id: "b", parent_page_id: "a" },
    ];
    expect(isWithinSubtree(cyclic, "z", "a")).toBe(false);
  });
});

describe("dropZone", () => {
  it("splits into three bands when nesting is allowed", () => {
    expect(dropZone(2, 30, true)).toBe("before");
    expect(dropZone(15, 30, true)).toBe("inside");
    expect(dropZone(28, 30, true)).toBe("after");
  });

  it("splits in half when nesting is not allowed", () => {
    expect(dropZone(10, 30, false)).toBe("before");
    expect(dropZone(20, 30, false)).toBe("after");
  });

  it("tolerates a zero height", () => {
    expect(dropZone(0, 0, true)).toBe("before");
  });
});
