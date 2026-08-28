/**
 * Convert stored block rows to markdown. The block content is BlockNote's
 * shape: { props, content: InlineContent[] }.
 */
import { rowsToDocument, type BlockRowLike, type EditorBlockLike } from "@/lib/blocks/sync";

type InlineContent = {
  type: string;
  text?: string;
  href?: string;
  content?: InlineContent[];
  styles?: Record<string, unknown>;
};

export function inlineToMarkdown(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return (content as InlineContent[])
    .map((item) => {
      if (item.type === "link") {
        return `[${inlineToMarkdown(item.content)}](${item.href ?? ""})`;
      }
      let text = item.text ?? "";
      const styles = item.styles ?? {};
      if (styles.code) text = `\`${text}\``;
      if (styles.bold) text = `**${text}**`;
      if (styles.italic) text = `*${text}*`;
      if (styles.strike) text = `~~${text}~~`;
      return text;
    })
    .join("");
}

function blockToMarkdown(block: EditorBlockLike, depth: number, index: number): string {
  const indent = "  ".repeat(depth);
  const props = (block.props ?? {}) as Record<string, unknown>;
  const inline = inlineToMarkdown(block.content);

  let line: string;
  switch (block.type) {
    case "heading": {
      const level = typeof props.level === "number" ? props.level : 1;
      line = `${"#".repeat(Math.min(level, 6))} ${inline}`;
      break;
    }
    case "bulletListItem":
      line = `${indent}- ${inline}`;
      break;
    case "numberedListItem":
      line = `${indent}${index + 1}. ${inline}`;
      break;
    case "checkListItem":
      line = `${indent}- [${props.checked === true ? "x" : " "}] ${inline}`;
      break;
    case "codeBlock": {
      const language = typeof props.language === "string" ? props.language : "";
      line = `\`\`\`${language}\n${inline}\n\`\`\``;
      break;
    }
    case "quote":
      line = `> ${inline}`;
      break;
    default:
      line = `${indent}${inline}`;
  }

  const children = (block.children ?? [])
    .map((child, i) => blockToMarkdown(child, depth + 1, i))
    .join("\n");

  return children ? `${line}\n${children}` : line;
}

export function blocksToMarkdown(rows: BlockRowLike[]): string {
  const doc = rowsToDocument(rows);
  return doc.map((block, i) => blockToMarkdown(block, 0, i)).join("\n\n");
}

export function pageToMarkdown(title: string, rows: BlockRowLike[]): string {
  const body = blocksToMarkdown(rows);
  return `# ${title || "Untitled"}\n\n${body}\n`;
}
