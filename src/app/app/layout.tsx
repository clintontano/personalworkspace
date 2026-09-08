import { redirect } from "next/navigation";
import { PageTree } from "@/components/sidebar/page-tree";
import { SidebarShell } from "@/components/sidebar/sidebar-shell";
import { ThemeToggle } from "@/components/theme-toggle";
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
    <div className="flex h-dvh">
      <SidebarShell>
        <div className="border-b p-4 pr-12 md:pr-4">
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
          <ThemeToggle />
          <a
            href="/app/mail"
            className="text-xs text-muted-foreground underline-offset-2 hover:underline"
          >
            Mail
          </a>
          <a
            href="/app/automations"
            className="text-xs text-muted-foreground underline-offset-2 hover:underline"
          >
            Automations
          </a>
          <a
            href="/app/settings"
            className="text-xs text-muted-foreground underline-offset-2 hover:underline"
          >
            Settings
          </a>
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
      </SidebarShell>
      {/* min-w-0 lets wide children scroll inside instead of stretching the
          page; pt-14 clears the fixed menu button on small screens. */}
      <main className="min-w-0 flex-1 overflow-y-auto pt-14 md:pt-0">{children}</main>
    </div>
  );
}
