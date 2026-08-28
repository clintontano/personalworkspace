import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { refreshAccessToken } from "@/lib/google/oauth";

const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";

export type GmailConnection = { id: string; workspaceId: string; email: string; accessToken: string };

/** Load the user's Gmail connection, refreshing the access token if stale. */
export async function gmailConnection(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<GmailConnection | null> {
  const { data: connection } = await supabase
    .from("google_connections")
    .select("id, workspace_id, email, access_token, refresh_token, token_expires_at")
    .eq("user_id", userId)
    .eq("kind", "gmail")
    .maybeSingle();
  if (!connection) return null;

  let accessToken = connection.access_token;
  if (new Date(connection.token_expires_at).getTime() < Date.now() + 60_000) {
    const refreshed = await refreshAccessToken(connection.refresh_token);
    accessToken = refreshed.access_token;
    await supabase
      .from("google_connections")
      .update({
        access_token: accessToken,
        token_expires_at: new Date(Date.now() + refreshed.expires_in * 1000).toISOString(),
      })
      .eq("id", connection.id);
  }

  return {
    id: connection.id,
    workspaceId: connection.workspace_id,
    email: connection.email,
    accessToken,
  };
}

export async function gmailFetch<T>(
  accessToken: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(`${GMAIL}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${accessToken}`, ...init?.headers },
  });
  if (!response.ok) {
    throw new Error(`gmail ${path} failed: ${response.status} ${await response.text()}`);
  }
  return response.json() as Promise<T>;
}
