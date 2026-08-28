import { NextResponse } from "next/server";
import { gmailConnection, gmailFetch } from "@/lib/gmail/client";
import { parseMessage, threadToMarkdown, type GmailMessage } from "@/lib/gmail/parse";
import * as api from "@/lib/mcp/api";
import { createClient } from "@/lib/supabase/server";

/**
 * POST /api/gmail/task — turn a thread into a database row.
 * Body: { threadId, databaseId, properties? }
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const connection = await gmailConnection(supabase, user.id);
  if (!connection) return NextResponse.json({ error: "gmail not connected" }, { status: 404 });

  const body = (await request.json()) as {
    threadId?: string;
    databaseId?: string;
    properties?: Record<string, unknown>;
  };
  if (!body.threadId || !body.databaseId) {
    return NextResponse.json({ error: "threadId and databaseId are required" }, { status: 400 });
  }

  try {
    const thread = await gmailFetch<{ messages?: GmailMessage[] }>(
      connection.accessToken,
      `/threads/${body.threadId}?format=full`,
    );
    const messages = (thread.messages ?? []).map(parseMessage);
    if (messages.length === 0) {
      return NextResponse.json({ error: "thread has no messages" }, { status: 404 });
    }

    const link = `https://mail.google.com/mail/u/0/#inbox/${body.threadId}`;
    const markdown = [
      `[Open in Gmail](${link})`,
      "",
      threadToMarkdown(messages),
    ].join("\n");

    // Reuses the same row-creation path as the MCP server, so property names
    // and option labels are coerced identically.
    const { pageId } = await api.createRow(supabase, connection.workspaceId, body.databaseId, {
      title: messages[0].subject,
      properties: body.properties ?? {},
      markdown,
    });

    return NextResponse.json({ pageId });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 502 });
  }
}
