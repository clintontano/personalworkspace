import { keyAfter } from "@/lib/order";
import { createClient } from "@/lib/supabase/client";

export type PageMeta = {
  id: string;
  workspace_id: string;
  parent_page_id: string | null;
  title: string;
  icon: string | null;
  order_key: string;
};

export async function fetchPages(workspaceId: string): Promise<PageMeta[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("pages")
    .select("id, workspace_id, parent_page_id, title, icon, order_key")
    .eq("workspace_id", workspaceId)
    .is("archived_at", null)
    .order("order_key");
  if (error) throw error;
  return data;
}

export async function createPage(
  workspaceId: string,
  parentPageId: string | null,
): Promise<string> {
  const supabase = createClient();
  let siblingQuery = supabase
    .from("pages")
    .select("order_key")
    .eq("workspace_id", workspaceId)
    .is("archived_at", null);
  siblingQuery = parentPageId
    ? siblingQuery.eq("parent_page_id", parentPageId)
    : siblingQuery.is("parent_page_id", null);
  const { data: last } = await siblingQuery
    .order("order_key", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data, error } = await supabase
    .from("pages")
    .insert({
      workspace_id: workspaceId,
      parent_page_id: parentPageId,
      title: "",
      order_key: keyAfter(last?.order_key ?? null),
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

export async function renamePage(pageId: string, title: string) {
  const supabase = createClient();
  const { error } = await supabase.from("pages").update({ title }).eq("id", pageId);
  if (error) throw error;
}

export async function archivePage(pageId: string) {
  const supabase = createClient();
  const { error } = await supabase
    .from("pages")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", pageId);
  if (error) throw error;
}
