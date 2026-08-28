/**
 * Markdown -> block content. The inverse of lib/export/markdown.ts, used by
 * the MCP server's append_blocks so an agent can write pages in markdown.
 *
 * Supports the block types the editor produces: headings, paragraphs, bullet
 * / numbered / checklist items (with indentation nesting), quotes and fenced
 * code blocks. Inline: bold, italic, code, strikethrough and links.
 */

export type ParsedBlock = {
  type: string;
  props: Record<string, unknown>;
  content: unknown;
  children: ParsedBlock[];
};

type Inline = { type: string; text?: string; href?: string; content?: unknown; styles?: Record<string, boolean> };

const INLINE_PATTERN =
  /(\[[^\]]*\]\([^)]*\))|(`[^`]+`)|(\*\*[^*]+\*\*)|(~~[^~]+~~)|(\*[^*]+\*)|(_[^_]+_)/;

/** Parse inline markdown into BlockNote inline content. */
export function parseInline(text: string): Inline[] {
  if (text === "") return [];
  const out: Inline[] = [];
  let rest = text;

  while (rest.length > 0) {
    const match = INLINE_PATTERN.exec(rest);
    if (!match || match.index === undefined) {
      out.push({ type: "text", text: rest, styles: {} });
      break;
    }
    if (match.index > 0) {
      out.push({ type: "text", text: rest.slice(0, match.index), styles: {} });
    }
    const token = match[0];

    if (token.startsWith("[")) {
      const link = /^\[([^\]]*)\]\(([^)]*)\)$/.exec(token)!;
      out.push({
        type: "link",
        href: link[2],
        content: [{ type: "text", text: link[1], styles: {} }],
      });
    } else if (token.startsWith("`")) {
      out.push({ type: "text", text: token.slice(1, -1), styles: { code: true } });
    } else if (token.startsWith("**")) {
      out.push({ type: "text", text: token.slice(2, -2), styles: { bold: true } });
    } else if (token.startsWith("~~")) {
      out.push({ type: "text", text: token.slice(2, -2), styles: { strike: true } });
    } else {
      out.push({ type: "text", text: token.slice(1, -1), styles: { italic: true } });
    }
    rest = rest.slice(match.index + token.length);
  }

  return out;
}

type Line = { indent: number; block: ParsedBlock };

function makeBlock(type: string, props: Record<string, unknown>, text: string): ParsedBlock {
  return { type, props, content: parseInline(text), children: [] };
}

/** Parse a markdown document into a nested block tree. */
export function markdownToBlocks(markdown: string): ParsedBlock[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const flat: Line[] = [];

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (raw.trim() === "") continue;

    const indent = Math.floor((raw.length - raw.trimStart().length) / 2);
    const line = raw.trim();

    // fenced code block: consume until the closing fence
    const fence = /^```(\w*)$/.exec(line);
    if (fence) {
      const body: string[] = [];
      i++;
      while (i < lines.length && lines[i].trim() !== "```") {
        body.push(lines[i]);
        i++;
      }
      flat.push({
        indent,
        block: {
          type: "codeBlock",
          props: fence[1] ? { language: fence[1] } : {},
          content: [{ type: "text", text: body.join("\n"), styles: {} }],
          children: [],
        },
      });
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flat.push({ indent, block: makeBlock("heading", { level: heading[1].length }, heading[2]) });
      continue;
    }

    const checklist = /^[-*]\s+\[([ xX])\]\s+(.*)$/.exec(line);
    if (checklist) {
      flat.push({
        indent,
        block: makeBlock("checkListItem", { checked: checklist[1].toLowerCase() === "x" }, checklist[2]),
      });
      continue;
    }

    const bullet = /^[-*]\s+(.*)$/.exec(line);
    if (bullet) {
      flat.push({ indent, block: makeBlock("bulletListItem", {}, bullet[1]) });
      continue;
    }

    const numbered = /^\d+\.\s+(.*)$/.exec(line);
    if (numbered) {
      flat.push({ indent, block: makeBlock("numberedListItem", {}, numbered[1]) });
      continue;
    }

    const quote = /^>\s?(.*)$/.exec(line);
    if (quote) {
      flat.push({ indent, block: makeBlock("quote", {}, quote[1]) });
      continue;
    }

    flat.push({ indent, block: makeBlock("paragraph", {}, line) });
  }

  // Fold indentation into nesting.
  const roots: ParsedBlock[] = [];
  const stack: { indent: number; block: ParsedBlock }[] = [];

  for (const { indent, block } of flat) {
    while (stack.length > 0 && stack[stack.length - 1].indent >= indent) stack.pop();
    if (stack.length === 0) roots.push(block);
    else stack[stack.length - 1].block.children.push(block);
    stack.push({ indent, block });
  }

  return roots;
}
