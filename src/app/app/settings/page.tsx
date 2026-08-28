import { createClient } from "@/lib/supabase/server";
import { googleConfigured } from "@/lib/google/oauth";
import { CalendarSyncSettings } from "./calendar-sync-settings";

export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: connection } = await supabase
    .from("google_connections")
    .select("id, email, kind, config, updated_at")
    .eq("user_id", user!.id)
    .eq("kind", "calendar")
    .maybeSingle();

  const { data: membership } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", user!.id)
    .limit(1)
    .maybeSingle();

  // Databases with at least one date property are valid sync targets.
  const { data: databases } = await supabase
    .from("databases")
    .select("page_id, pages!databases_page_id_fkey(title), database_properties(id, name, type)")
    .eq("workspace_id", membership!.workspace_id);

  const targets = (databases ?? [])
    .map((db) => ({
      databaseId: db.page_id,
      title: (db.pages as unknown as { title: string }).title || "Untitled",
      dateProperties: (db.database_properties ?? [])
        .filter((p) => p.type === "date")
        .map((p) => ({ id: p.id, name: p.name })),
    }))
    .filter((t) => t.dateProperties.length > 0);

  const config = (connection?.config ?? {}) as {
    databaseId?: string;
    datePropertyId?: string;
    lastSyncAt?: string;
  };

  return (
    <div className="mx-auto max-w-2xl px-8 py-12">
      <h1 className="mb-8 text-2xl font-bold">Settings</h1>

      <section className="rounded-lg border p-4">
        <h2 className="mb-1 font-semibold">Google Calendar</h2>
        {!googleConfigured() ? (
          <div className="text-sm text-muted-foreground">
            <p className="mb-2">
              Not configured. To enable two-way sync, create an OAuth client in
              Google Cloud Console and add to <code>.env.local</code>:
            </p>
            <pre className="rounded bg-muted p-2 text-xs">
              {"GOOGLE_CLIENT_ID=...\nGOOGLE_CLIENT_SECRET=..."}
            </pre>
            <p className="mt-2">
              Authorized redirect URI:{" "}
              <code>http://localhost:3000/api/google/callback</code>
            </p>
          </div>
        ) : (
          <CalendarSyncSettings
            connected={Boolean(connection)}
            email={connection?.email ?? null}
            targets={targets}
            currentDatabaseId={config.databaseId ?? null}
            currentDatePropertyId={config.datePropertyId ?? null}
            lastSyncAt={config.lastSyncAt ?? null}
          />
        )}
      </section>
    </div>
  );
}
