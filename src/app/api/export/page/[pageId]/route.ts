import { NextResponse } from "next/server";
import type { BlockRowLike } from "@/lib/blocks/sync";
import { pageToMarkdown } from "@/lib/export/markdown";
import { createClient } from "@/lib/supabase/server";

/** Markdown export of a single page (children pages listed as links). */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ pageId: string }> },
) {
  const { pageId } = await params;
  const supabase = await createClient();

  const { data: page } = await supabase
    .from("pages")
    .select("id, title")
    .eq("id", pageId)
    .maybeSingle();
  if (!page) return NextResponse.json({ error: "not found" }, { status: 404 });

  const { data: blocks } = await supabase
    .from("blocks")
    .select("id, parent_block_id, type, content, order_key")
    .eq("page_id", pageId)
    .order("order_key");

  let markdown = pageToMarkdown(page.title, (blocks ?? []) as BlockRowLike[]);

  const { data: children } = await supabase
    .from("pages")
    .select("id, title")
    .eq("parent_page_id", pageId)
    .is("archived_at", null)
    .order("order_key");
  if (children && children.length > 0) {
    markdown +=
      "\n## Sub-pages\n\n" +
      children.map((c) => `- ${c.title || "Untitled"} (${c.id})`).join("\n") +
      "\n";
  }

  const safeTitle = (page.title || "untitled").replace(/[^a-z0-9-_]+/gi, "-");
  return new NextResponse(markdown, {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "content-disposition": `attachment; filename="${safeTitle}.md"`,
    },
  });
}
