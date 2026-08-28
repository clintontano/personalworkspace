import { loadInbox } from "@/lib/gmail/inbox";
import type { ParsedThread } from "@/lib/gmail/parse";
import { googleConfigured } from "@/lib/google/oauth";
import { createClient } from "@/lib/supabase/server";
import { MailScreen } from "./mail-screen";

export default async function MailPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: connection } = await supabase
    .from("google_connections")
    .select("email")
    .eq("user_id", user!.id)
    .eq("kind", "gmail")
    .maybeSingle();

  const { data: membership } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", user!.id)
    .limit(1)
    .maybeSingle();

  const { data: databases } = await supabase
    .from("databases")
    .select("page_id, pages!databases_page_id_fkey(title)")
    .eq("workspace_id", membership!.workspace_id);

  const targets = (databases ?? []).map((d) => ({
    id: d.page_id,
    title: (d.pages as unknown as { title: string }).title || "Untitled",
  }));

  if (!googleConfigured()) {
    return (
      <div className="mx-auto max-w-2xl px-8 py-12">
        <h1 className="mb-4 text-2xl font-bold">Mail</h1>
        <div className="rounded-lg border p-4 text-sm text-muted-foreground">
          <p className="mb-2">
            Google OAuth is not configured. Add to <code>.env.local</code>:
          </p>
          <pre className="rounded bg-muted p-2 text-xs">
            {"GOOGLE_CLIENT_ID=...\nGOOGLE_CLIENT_SECRET=..."}
          </pre>
          <p className="mt-2">
            Then enable the Gmail API for the project and connect below. Scope
            requested: <code>gmail.readonly</code>.
          </p>
        </div>
      </div>
    );
  }

  // Fetched here rather than in a client effect: one round trip, and the
  // inbox is already rendered on first paint.
  let threads: ParsedThread[] | null = null;
  let loadError: string | null = null;
  if (connection) {
    try {
      threads = (await loadInbox(supabase, user!.id))?.threads ?? [];
    } catch (error) {
      loadError = (error as Error).message;
    }
  }

  return (
    <MailScreen
      connected={Boolean(connection)}
      email={connection?.email ?? null}
      databases={targets}
      initialThreads={threads}
      initialError={loadError}
    />
  );
}
