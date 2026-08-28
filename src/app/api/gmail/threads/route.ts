import { NextResponse, type NextRequest } from "next/server";
import { gmailConnection, gmailFetch } from "@/lib/gmail/client";
import { loadInbox } from "@/lib/gmail/inbox";
import { parseMessage, threadToMarkdown, type GmailMessage } from "@/lib/gmail/parse";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/gmail/threads              — inbox list
 * GET /api/gmail/threads?id=<thread>  — one thread with its messages
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const connection = await gmailConnection(supabase, user.id);
  if (!connection) return NextResponse.json({ error: "gmail not connected" }, { status: 404 });

  const threadId = request.nextUrl.searchParams.get("id");

  try {
    if (threadId) {
      const thread = await gmailFetch<{ messages?: GmailMessage[] }>(
        connection.accessToken,
        `/threads/${threadId}?format=full`,
      );
      const messages = (thread.messages ?? []).map(parseMessage);
      return NextResponse.json({
        threadId,
        subject: messages[0]?.subject ?? "(no subject)",
        messages,
        markdown: threadToMarkdown(messages),
      });
    }

    const inbox = await loadInbox(supabase, user.id);
    return NextResponse.json(inbox ?? { error: "gmail not connected" });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 502 });
  }
}
