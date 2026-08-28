import { describe, expect, it } from "vitest";
import type { BlockRowLike } from "@/lib/blocks/sync";
import { blocksToMarkdown, inlineToMarkdown } from "./markdown";

const row = (
  id: string,
  type: string,
  content: unknown,
  orderKey: string,
  parent: string | null = null,
  props: Record<string, unknown> = {},
): BlockRowLike => ({
  id,
  parent_block_id: parent,
  type,
  content: { props, content },
  order_key: orderKey,
});

const text = (t: string, styles: Record<string, unknown> = {}) => ({
  type: "text",
  text: t,
  styles,
});

describe("inlineToMarkdown", () => {
  it("renders styles", () => {
    expect(
      inlineToMarkdown([
        text("plain "),
        text("bold", { bold: true }),
        text(" and "),
        text("code", { code: true }),
      ]),
    ).toBe("plain **bold** and `code`");
  });

  it("renders links", () => {
    expect(
      inlineToMarkdown([
        { type: "link", href: "https://example.com", content: [text("site")] },
      ]),
    ).toBe("[site](https://example.com)");
  });
});

describe("blocksToMarkdown", () => {
  it("renders headings, lists and nesting", () => {
    const rows = [
      row("h", "heading", [text("Title")], "a0", null, { level: 2 }),
      row("p", "paragraph", [text("Hello")], "a1"),
      row("l1", "bulletListItem", [text("one")], "a2"),
      row("l2", "bulletListItem", [text("nested")], "a0", "l1"),
      row("c", "checkListItem", [text("done thing")], "a3", null, { checked: true }),
    ];
    expect(blocksToMarkdown(rows)).toBe(
      [
        "## Title",
        "",
        "Hello",
        "",
        "- one\n  - nested",
        "",
        "- [x] done thing",
      ].join("\n"),
    );
  });

  it("orders numbered lists by position", () => {
    const rows = [
      row("a", "numberedListItem", [text("first")], "a0"),
      row("b", "numberedListItem", [text("second")], "a1"),
    ];
    expect(blocksToMarkdown(rows)).toBe("1. first\n\n2. second");
  });
});
