/**
 * Gmail message parsing. Pure functions over the API's payload shape, so the
 * fiddly parts (header lookup, base64url bodies, nested MIME parts) are
 * unit-tested rather than debugged against a live mailbox.
 */

export type GmailHeader = { name: string; value: string };

export type GmailPart = {
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: { data?: string; size?: number; attachmentId?: string };
  parts?: GmailPart[];
};

export type GmailMessage = {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: GmailPart;
};

export type ParsedMessage = {
  id: string;
  threadId: string;
  from: string;
  fromName: string;
  to: string;
  subject: string;
  date: string;
  snippet: string;
  body: string;
  unread: boolean;
};

export function header(part: GmailPart | undefined, name: string): string {
  const found = part?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase());
  return found?.value ?? "";
}

export function decodeBase64Url(data: string): string {
  const normalized = data.replace(/-/g, "+").replace(/_/g, "/");
  try {
    return Buffer.from(normalized, "base64").toString("utf8");
  } catch {
    return "";
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Prefer text/plain; fall back to the first text/html, stripped. */
export function extractBody(part: GmailPart | undefined): string {
  if (!part) return "";

  const collect = (node: GmailPart, mime: string): string | null => {
    if (node.mimeType === mime && node.body?.data && !node.filename) {
      return decodeBase64Url(node.body.data);
    }
    for (const child of node.parts ?? []) {
      const found = collect(child, mime);
      if (found !== null) return found;
    }
    return null;
  };

  const plain = collect(part, "text/plain");
  if (plain !== null) return plain.trim();
  const html = collect(part, "text/html");
  if (html !== null) return stripHtml(html);
  if (part.body?.data) return decodeBase64Url(part.body.data).trim();
  return "";
}

/** "Ada Lovelace <ada@example.com>" -> { name, email } */
export function parseAddress(value: string): { name: string; email: string } {
  const angled = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(value);
  if (angled) return { name: angled[1].trim(), email: angled[2].trim() };
  const email = value.trim();
  return { name: email.split("@")[0] ?? "", email };
}

export function parseMessage(message: GmailMessage): ParsedMessage {
  const from = header(message.payload, "From");
  const { name, email } = parseAddress(from);
  const dateHeader = header(message.payload, "Date");
  const date = message.internalDate
    ? new Date(Number(message.internalDate)).toISOString()
    : dateHeader
      ? new Date(dateHeader).toISOString()
      : "";

  return {
    id: message.id,
    threadId: message.threadId,
    from: email,
    fromName: name || email,
    to: header(message.payload, "To"),
    subject: header(message.payload, "Subject") || "(no subject)",
    date,
    snippet: message.snippet ?? "",
    body: extractBody(message.payload),
    unread: (message.labelIds ?? []).includes("UNREAD"),
  };
}

export type ParsedThread = {
  threadId: string;
  subject: string;
  fromName: string;
  from: string;
  date: string;
  snippet: string;
  messageCount: number;
  unread: boolean;
};

/** Summarize a thread from its messages: newest message wins for display. */
export function summarizeThread(threadId: string, messages: GmailMessage[]): ParsedThread {
  const parsed = messages.map(parseMessage);
  const newest = parsed[parsed.length - 1] ?? null;
  const first = parsed[0] ?? null;
  return {
    threadId,
    subject: first?.subject ?? "(no subject)",
    fromName: newest?.fromName ?? "",
    from: newest?.from ?? "",
    date: newest?.date ?? "",
    snippet: newest?.snippet ?? "",
    messageCount: parsed.length,
    unread: parsed.some((m) => m.unread),
  };
}

/** Markdown for a thread, used when turning it into a task row. */
export function threadToMarkdown(messages: ParsedMessage[]): string {
  return messages
    .map((message) => {
      const when = message.date ? new Date(message.date).toLocaleString() : "";
      const body = message.body
        .split("\n")
        .filter((line) => !line.trimStart().startsWith(">"))
        .join("\n")
        .trim();
      return `**${message.fromName}** — ${when}\n\n${body}`;
    })
    .join("\n\n---\n\n");
}
