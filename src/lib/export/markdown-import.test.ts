import { describe, expect, it } from "vitest";
import type { BlockRowLike } from "@/lib/blocks/sync";
import { blocksToMarkdown } from "./markdown";
import { markdownToBlocks, parseInline, type ParsedBlock } from "./markdown-import";

/** Flatten a parsed tree into block rows, as the MCP server does. */
function toRows(blocks: ParsedBlock[], parent: string | null = null, out: BlockRowLike[] = []): BlockRowLike[] {
  blocks.forEach((block, i) => {
    const id = `${parent ?? "r"}-${i}`;
    out.push({
      id,
      parent_block_id: parent,
      type: block.type,
      content: { props: block.props, content: block.content },
      order_key: `a${i}`,
    });
    toRows(block.children, id, out);
  });
  return out;
}

describe("parseInline", () => {
  it("parses bold, italic, code and strikethrough", () => {
    expect(parseInline("a **b** c `d` e ~~f~~ g *h*")).toEqual([
      { type: "text", text: "a ", styles: {} },
      { type: "text", text: "b", styles: { bold: true } },
      { type: "text", text: " c ", styles: {} },
      { type: "text", text: "d", styles: { code: true } },
      { type: "text", text: " e ", styles: {} },
      { type: "text", text: "f", styles: { strike: true } },
      { type: "text", text: " g ", styles: {} },
      { type: "text", text: "h", styles: { italic: true } },
    ]);
  });

  it("parses links", () => {
    expect(parseInline("see [docs](https://x.dev)")).toEqual([
      { type: "text", text: "see ", styles: {} },
      { type: "link", href: "https://x.dev", content: [{ type: "text", text: "docs", styles: {} }] },
    ]);
  });

  it("returns nothing for an empty string", () => {
    expect(parseInline("")).toEqual([]);
  });
});

describe("markdownToBlocks", () => {
  it("parses each block type", () => {
    const blocks = markdownToBlocks(
      ["## Title", "", "A paragraph.", "- bullet", "1. numbered", "- [x] done", "> quoted"].join("\n"),
    );
    expect(blocks.map((b) => b.type)).toEqual([
      "heading",
      "paragraph",
      "bulletListItem",
      "numberedListItem",
      "checkListItem",
      "quote",
    ]);
    expect(blocks[0].props).toEqual({ level: 2 });
    expect(blocks[4].props).toEqual({ checked: true });
  });

  it("nests by indentation", () => {
    const blocks = markdownToBlocks(["- parent", "  - child", "    - grandchild", "- sibling"].join("\n"));
    expect(blocks).toHaveLength(2);
    expect(blocks[0].children[0].children[0].content).toEqual([
      { type: "text", text: "grandchild", styles: {} },
    ]);
  });

  it("keeps fenced code verbatim", () => {
    const blocks = markdownToBlocks(["```ts", "const a = 1;", "const b = 2;", "```"].join("\n"));
    expect(blocks[0].type).toBe("codeBlock");
    expect(blocks[0].props).toEqual({ language: "ts" });
    expect(blocks[0].content).toEqual([
      { type: "text", text: "const a = 1;\nconst b = 2;", styles: {} },
    ]);
  });

  it("ignores blank lines", () => {
    expect(markdownToBlocks("\n\nonly one\n\n")).toHaveLength(1);
  });

  it("round-trips through the markdown exporter", () => {
    const source = [
      "## Heading",
      "",
      "Text with **bold** and `code`.",
      "",
      "- one",
      "  - nested",
      "",
      "- [ ] todo",
    ].join("\n");
    const rendered = blocksToMarkdown(toRows(markdownToBlocks(source)));
    expect(rendered).toBe(
      ["## Heading", "", "Text with **bold** and `code`.", "", "- one\n  - nested", "", "- [ ] todo"].join("\n"),
    );
  });
});
