import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { gmailConnection, gmailFetch } from "./client";
import { summarizeThread, type GmailMessage, type ParsedThread } from "./parse";

export type Inbox = {
  email: string;
  threads: ParsedThread[];
};

/** Inbox thread summaries. Shared by the Mail page (initial render) and the
 * refresh route, so both return the same shape. */
export async function loadInbox(
  supabase: SupabaseClient<Database>,
  userId: string,
  limit = 25,
): Promise<Inbox | null> {
  const connection = await gmailConnection(supabase, userId);
  if (!connection) return null;

  const list = await gmailFetch<{ threads?: { id: string }[] }>(
    connection.accessToken,
    `/threads?labelIds=INBOX&maxResults=${limit}`,
  );

  const threads = await Promise.all(
    (list.threads ?? []).map(async (thread) => {
      const detail = await gmailFetch<{ messages?: GmailMessage[] }>(
        connection.accessToken,
        `/threads/${thread.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
      );
      return summarizeThread(thread.id, detail.messages ?? []);
    }),
  );

  return { email: connection.email, threads };
}
