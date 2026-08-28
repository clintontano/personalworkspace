import { redirect } from "next/navigation";
import { PageTree } from "@/components/sidebar/page-tree";
import { Button } from "@/components/ui/button";
import type { PageMeta } from "@/lib/pages";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "./actions";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: membership } = await supabase
    .from("workspace_members")
    .select("role, workspaces(id, name, icon)")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();

  const workspace = membership?.workspaces;

  let pages: PageMeta[] = [];
  if (workspace) {
    const { data } = await supabase
      .from("pages")
      .select(
        "id, workspace_id, parent_page_id, title, icon, order_key, databases(page_id), database_rows!database_rows_page_id_fkey(database_id)",
      )
      .eq("workspace_id", workspace.id)
      .is("archived_at", null)
      .order("order_key");
    pages = (data ?? [])
      .filter((p) => p.database_rows === null)
      .map(({ databases, database_rows: _rows, ...page }) => ({
        ...page,
        isDatabase: databases !== null,
      }));
  }

  return (
    <div className="flex h-screen">
      <aside className="flex w-64 shrink-0 flex-col border-r bg-muted/30">
        <div className="border-b p-4">
          <p data-testid="workspace-name" className="truncate font-semibold">
            {workspace ? `${workspace.icon ?? ""} ${workspace.name}`.trim() : "No workspace"}
          </p>
          <p className="truncate text-xs text-muted-foreground">{user.email}</p>
        </div>
        <nav className="flex-1 overflow-y-auto p-2">
          {workspace ? (
            <PageTree workspaceId={workspace.id} initialPages={pages} />
          ) : null}
        </nav>
        <div className="flex flex-col gap-2 border-t p-4">
          <a
            href="/api/export"
            download
            className="text-xs text-muted-foreground underline-offset-2 hover:underline"
          >
            Export workspace (JSON)
          </a>
          <form action={signOut}>
            <Button type="submit" variant="outline" size="sm" className="w-full">
              Sign out
            </Button>
          </form>
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}
