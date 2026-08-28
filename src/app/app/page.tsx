import { Database, FileText } from "lucide-react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export default async function AppHomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: membership } = await supabase
    .from("workspace_members")
    .select("workspace_id, workspaces(name)")
    .eq("user_id", user!.id)
    .limit(1)
    .maybeSingle();

  const { data: recent } = await supabase
    .from("pages")
    .select("id, title, icon, updated_at, databases(page_id), database_rows!database_rows_page_id_fkey(database_id)")
    .eq("workspace_id", membership!.workspace_id)
    .is("archived_at", null)
    .order("updated_at", { ascending: false })
    .limit(8);

  return (
    <div className="mx-auto max-w-3xl px-8 py-16">
      <h1 className="mb-1 text-3xl font-bold">
        {membership?.workspaces?.name ?? "Workspace"}
      </h1>
      <p className="mb-8 text-sm text-muted-foreground">
        Recently updated
      </p>
      <div className="flex flex-col">
        {(recent ?? []).map((page) => (
          <Link
            key={page.id}
            href={`/app/p/${page.id}`}
            className="flex items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-muted"
          >
            <span className="w-5 shrink-0">
              {page.icon ??
                (page.databases !== null ? (
                  <Database className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <FileText className="h-4 w-4 text-muted-foreground" />
                ))}
            </span>
            <span className="font-medium">{page.title || "Untitled"}</span>
            {page.database_rows !== null ? (
              <span className="text-xs text-muted-foreground">row</span>
            ) : null}
          </Link>
        ))}
      </div>
    </div>
  );
}
