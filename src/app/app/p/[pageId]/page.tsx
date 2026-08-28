import { notFound } from "next/navigation";
import { DatabaseScreen } from "@/components/database/database-screen";
import { PageView } from "@/components/editor/page-view";
import type { BlockRowLike } from "@/lib/blocks/sync";
import { toRow, type ViewConfig, type ViewRecord, type ViewType } from "@/lib/db/data";
import type { Property, PropertyConfig, PropertyType, PropertyValue } from "@/lib/db/model";
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

  // Database page → database screen
  const { data: database } = await supabase
    .from("databases")
    .select("page_id")
    .eq("page_id", pageId)
    .maybeSingle();

  if (database) {
    const [{ data: props }, { data: views }, { data: rawRows }] = await Promise.all([
      supabase
        .from("database_properties")
        .select("id, name, type, config, order_key")
        .eq("database_id", pageId)
        .order("order_key"),
      supabase
        .from("views")
        .select("id, name, type, config, order_key")
        .eq("database_id", pageId)
        .order("order_key"),
      supabase
        .from("database_rows")
        .select(
          "page_id, properties, order_key, created_at, updated_at, pages!inner(title, icon, archived_at)",
        )
        .eq("database_id", pageId)
        .is("pages.archived_at", null)
        .order("order_key"),
    ]);

    return (
      <DatabaseScreen
        key={page.id}
        databasePageId={page.id}
        workspaceId={page.workspace_id}
        initialTitle={page.title}
        initialProperties={(props ?? []).map((p) => ({
          id: p.id,
          name: p.name,
          type: p.type as PropertyType,
          config: (p.config ?? {}) as PropertyConfig,
          order_key: p.order_key,
        }))}
        initialViews={(views ?? []).map(
          (v): ViewRecord => ({
            id: v.id,
            name: v.name,
            type: v.type as ViewType,
            config: (v.config ?? {}) as ViewConfig,
            order_key: v.order_key,
          }),
        )}
        initialRows={(rawRows ?? []).map(toRow)}
      />
    );
  }

  // Row page → properties panel + block editor
  const { data: rowRecord } = await supabase
    .from("database_rows")
    .select("database_id, properties")
    .eq("page_id", pageId)
    .maybeSingle();

  let rowProperties: Property[] | null = null;
  let rowValues: Record<string, PropertyValue> | null = null;
  if (rowRecord) {
    const { data: props } = await supabase
      .from("database_properties")
      .select("id, name, type, config, order_key")
      .eq("database_id", rowRecord.database_id)
      .order("order_key");
    rowProperties = (props ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      type: p.type as PropertyType,
      config: (p.config ?? {}) as PropertyConfig,
      order_key: p.order_key,
    }));
    rowValues = (rowRecord.properties ?? {}) as Record<string, PropertyValue>;
  }

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
      rowProperties={rowProperties}
      rowValues={rowValues}
    />
  );
}
