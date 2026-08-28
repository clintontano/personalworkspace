import { describe, expect, it } from "vitest";
import { assignSiblingKeys, keyAfter } from "./order";

const keys = (pairs: [string, string][]) => new Map(pairs);

describe("assignSiblingKeys", () => {
  it("assigns increasing keys to a fresh list", () => {
    const changed = assignSiblingKeys(["a", "b", "c"], new Map());
    const [ka, kb, kc] = [changed.get("a")!, changed.get("b")!, changed.get("c")!];
    expect(ka < kb && kb < kc).toBe(true);
  });

  it("is a no-op when order is unchanged", () => {
    const existing = keys([
      ["a", "a0"],
      ["b", "a1"],
      ["c", "a2"],
    ]);
    expect(assignSiblingKeys(["a", "b", "c"], existing).size).toBe(0);
  });

  it("moving one item only rewrites that item", () => {
    const existing = keys([
      ["a", "a0"],
      ["b", "a1"],
      ["c", "a2"],
    ]);
    // c moved between a and b: exactly one row is rewritten and the
    // resulting keys sort in the new order
    const order = ["a", "c", "b"];
    const changed = assignSiblingKeys(order, existing);
    expect(changed.size).toBe(1);
    const resolved = order.map((id) => changed.get(id) ?? existing.get(id)!);
    expect([...resolved].sort()).toEqual(resolved);
  });

  it("inserting in the middle squeezes a key between neighbours", () => {
    const existing = keys([
      ["a", "a0"],
      ["b", "a1"],
    ]);
    const changed = assignSiblingKeys(["a", "x", "b"], existing);
    expect([...changed.keys()]).toEqual(["x"]);
    const kx = changed.get("x")!;
    expect(kx > "a0" && kx < "a1").toBe(true);
  });

  it("keeps the full result strictly sorted", () => {
    const existing = keys([
      ["a", "a0"],
      ["b", "a1"],
      ["c", "a2"],
      ["d", "a3"],
    ]);
    const order = ["d", "b", "a", "c"];
    const changed = assignSiblingKeys(order, existing);
    const resolved = order.map((id) => changed.get(id) ?? existing.get(id)!);
    const sorted = [...resolved].sort();
    expect(resolved).toEqual(sorted);
    expect(new Set(resolved).size).toBe(resolved.length);
  });
});

describe("keyAfter", () => {
  it("appends after the last key", () => {
    const k1 = keyAfter(null);
    const k2 = keyAfter(k1);
    expect(k2 > k1).toBe(true);
  });
});
