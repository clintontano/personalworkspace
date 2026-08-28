import { describe, expect, it } from "vitest";
import {
  diffBlocks,
  rowsToDocument,
  type BlockRowLike,
  type EditorBlockLike,
} from "./sync";

const p = (id: string, text: string, children: EditorBlockLike[] = []): EditorBlockLike => ({
  id,
  type: "paragraph",
  props: {},
  content: [{ type: "text", text, styles: {} }],
  children,
});

const row = (
  id: string,
  text: string,
  orderKey: string,
  parent: string | null = null,
): BlockRowLike => ({
  id,
  parent_block_id: parent,
  type: "paragraph",
  content: { props: {}, content: [{ type: "text", text, styles: {} }] },
  order_key: orderKey,
});

describe("diffBlocks", () => {
  it("inserts everything for a fresh document", () => {
    const ops = diffBlocks([], [p("a", "one"), p("b", "two")]);
    expect(ops.deleteIds).toEqual([]);
    expect(ops.upserts.map((u) => u.id)).toEqual(["a", "b"]);
    expect(ops.upserts[0].order_key < ops.upserts[1].order_key).toBe(true);
  });

  it("is a no-op when nothing changed", () => {
    const rows = [row("a", "one", "a0"), row("b", "two", "a1")];
    const ops = diffBlocks(rows, rowsToDocument(rows));
    expect(ops.upserts).toEqual([]);
    expect(ops.deleteIds).toEqual([]);
  });

  it("detects a content edit without touching order keys", () => {
    const rows = [row("a", "one", "a0"), row("b", "two", "a1")];
    const ops = diffBlocks(rows, [p("a", "one EDITED"), p("b", "two")]);
    expect(ops.upserts.map((u) => u.id)).toEqual(["a"]);
    expect(ops.upserts[0].order_key).toBe("a0");
    expect(ops.deleteIds).toEqual([]);
  });

  it("deletes removed blocks", () => {
    const rows = [row("a", "one", "a0"), row("b", "two", "a1")];
    const ops = diffBlocks(rows, [p("b", "two")]);
    expect(ops.deleteIds).toEqual(["a"]);
    expect(ops.upserts).toEqual([]);
  });

  it("reorder rewrites only the moved block", () => {
    const rows = [row("a", "one", "a0"), row("b", "two", "a1"), row("c", "three", "a2")];
    const doc = [p("a", "one"), p("c", "three"), p("b", "two")];
    const ops = diffBlocks(rows, doc);
    expect(ops.upserts.length).toBe(1);
    expect(ops.deleteIds).toEqual([]);
    // applying the ops and rebuilding the document preserves the new order
    const applied = rows
      .filter((r) => !ops.deleteIds.includes(r.id))
      .map((r) => {
        const u = ops.upserts.find((u) => u.id === r.id);
        return u ? { ...r, ...u } : r;
      });
    expect(rowsToDocument(applied).map((b) => b.id)).toEqual(["a", "c", "b"]);
  });

  it("nesting a block under another changes its parent and gets a fresh key", () => {
    const rows = [row("a", "one", "a0"), row("b", "two", "a1")];
    const ops = diffBlocks(rows, [p("a", "one", [p("b", "two")])]);
    expect(ops.upserts.map((u) => u.id)).toEqual(["b"]);
    expect(ops.upserts[0].parent_block_id).toBe("a");
  });

  it("round-trips rows -> document -> rows", () => {
    const rows = [
      row("a", "one", "a0"),
      row("b", "child", "a0", "a"),
      row("c", "two", "a1"),
    ];
    const doc = rowsToDocument(rows);
    expect(doc.map((b) => b.id)).toEqual(["a", "c"]);
    expect(doc[0].children!.map((b) => b.id)).toEqual(["b"]);
    expect(diffBlocks(rows, doc).upserts).toEqual([]);
  });
});
