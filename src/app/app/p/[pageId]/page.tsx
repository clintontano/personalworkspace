import { notFound } from "next/navigation";
import { PageView } from "@/components/editor/page-view";
import type { BlockRowLike } from "@/lib/blocks/sync";
import { createClient } from "@/lib/supabase/server";

export default async function Page({
  params,
}: {
  params: Promise<{ pageId: string }>;
}) {
  const { pageId } = await params;
  const supabase = await createClient();

  const { data: page } = await supabase
    .from("pages")
    .select("id, workspace_id, title")
    .eq("id", pageId)
    .is("archived_at", null)
    .maybeSingle();

  if (!page) notFound();

  const { data: blocks } = await supabase
    .from("blocks")
    .select("id, parent_block_id, type, content, order_key")
    .eq("page_id", pageId)
    .order("order_key");

  return (
    <PageView
      key={page.id}
      pageId={page.id}
      workspaceId={page.workspace_id}
      initialTitle={page.title}
      initialRows={(blocks ?? []) as BlockRowLike[]}
    />
  );
}
