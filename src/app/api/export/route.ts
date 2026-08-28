import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** Full-workspace JSON export. Everything the workspace holds, RLS-scoped. */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: membership } = await supabase
    .from("workspace_members")
    .select("workspace_id, workspaces(name)")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();
  if (!membership) return NextResponse.json({ error: "no workspace" }, { status: 404 });

  const workspaceId = membership.workspace_id;
  const pick = async (table: "pages" | "blocks" | "databases" | "database_properties" | "database_rows" | "views") => {
    const { data, error } = await supabase
      .from(table)
      .select("*")
      .eq("workspace_id", workspaceId);
    if (error) throw error;
    return data;
  };

  const [pages, blocks, databases, properties, rows, views] = await Promise.all([
    pick("pages"),
    pick("blocks"),
    pick("databases"),
    pick("database_properties"),
    pick("database_rows"),
    pick("views"),
  ]);

  const body = {
    exported_at: new Date().toISOString(),
    workspace: { id: workspaceId, name: membership.workspaces?.name },
    pages,
    blocks,
    databases,
    database_properties: properties,
    database_rows: rows,
    views,
  };

  return new NextResponse(JSON.stringify(body, null, 2), {
    headers: {
      "content-type": "application/json",
      "content-disposition": `attachment; filename="workspace-export.json"`,
    },
  });
}
