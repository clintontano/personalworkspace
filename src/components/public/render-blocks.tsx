import type { JSX } from "react";
import { rowsToDocument, type BlockRowLike, type EditorBlockLike } from "@/lib/blocks/sync";

type InlineItem = {
  type: string;
  text?: string;
  href?: string;
  content?: InlineItem[];
  styles?: Record<string, unknown>;
};

function renderInline(content: unknown, keyPrefix = ""): React.ReactNode[] {
  if (!Array.isArray(content)) return [];
  return (content as InlineItem[]).map((item, i) => {
    const key = `${keyPrefix}${i}`;
    if (item.type === "link") {
      return (
        <a
          key={key}
          href={item.href}
          rel="noopener noreferrer nofollow"
          className="text-blue-600 underline underline-offset-2"
        >
          {renderInline(item.content, `${key}-`)}
        </a>
      );
    }
    let node: React.ReactNode = item.text ?? "";
    const styles = item.styles ?? {};
    if (styles.code) node = <code className="rounded bg-muted px-1 py-0.5 text-[0.9em]">{node}</code>;
    if (styles.bold) node = <strong>{node}</strong>;
    if (styles.italic) node = <em>{node}</em>;
    if (styles.strike) node = <s>{node}</s>;
    if (styles.underline) node = <u>{node}</u>;
    return <span key={key}>{node}</span>;
  });
}

function renderBlock(block: EditorBlockLike, key: string): React.ReactNode {
  const props = (block.props ?? {}) as Record<string, unknown>;
  const children = block.children ?? [];
  const inline = renderInline(block.content, `${key}-`);

  switch (block.type) {
    case "heading": {
      const level = typeof props.level === "number" ? Math.min(props.level, 6) : 1;
      const Tag = `h${level}` as keyof JSX.IntrinsicElements;
      const size = level === 1 ? "text-3xl" : level === 2 ? "text-2xl" : "text-xl";
      return (
        <div key={key}>
          <Tag className={`mt-8 mb-2 font-bold ${size}`}>{inline}</Tag>
          {renderList(children, key)}
        </div>
      );
    }
    case "bulletListItem":
      return (
        <li key={key} className="ml-6 list-disc">
          {inline}
          {children.length > 0 ? <ul className="mt-1">{renderList(children, key)}</ul> : null}
        </li>
      );
    case "numberedListItem":
      return (
        <li key={key} className="ml-6 list-decimal">
          {inline}
          {children.length > 0 ? <ol className="mt-1">{renderList(children, key)}</ol> : null}
        </li>
      );
    case "checkListItem":
      return (
        <li key={key} className="ml-6 flex list-none items-start gap-2">
          <input type="checkbox" checked={props.checked === true} readOnly className="mt-1" />
          <span>
            {inline}
            {children.length > 0 ? <ul className="mt-1">{renderList(children, key)}</ul> : null}
          </span>
        </li>
      );
    case "codeBlock":
      return (
        <pre key={key} className="my-3 overflow-x-auto rounded-md bg-muted p-3 text-sm">
          <code>{renderInline(block.content, `${key}-`)}</code>
        </pre>
      );
    case "quote":
      return (
        <blockquote key={key} className="my-3 border-l-2 pl-4 text-muted-foreground">
          {inline}
        </blockquote>
      );
    default:
      return (
        <div key={key}>
          <p className="my-2 leading-7">{inline}</p>
          {renderList(children, key)}
        </div>
      );
  }
}

function renderList(blocks: EditorBlockLike[], keyPrefix: string): React.ReactNode {
  return blocks.map((block, i) => renderBlock(block, `${keyPrefix}.${i}`));
}

/** Read-only render of stored blocks for public site pages. */
export function RenderBlocks({ rows }: { rows: BlockRowLike[] }) {
  return <>{renderList(rowsToDocument(rows), "b")}</>;
}
