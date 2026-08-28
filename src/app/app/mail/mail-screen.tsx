"use client";

import { Mail, RefreshCw } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type ThreadSummary = {
  threadId: string;
  subject: string;
  fromName: string;
  date: string;
  snippet: string;
  messageCount: number;
  unread: boolean;
};

type ThreadDetail = {
  threadId: string;
  subject: string;
  messages: { id: string; fromName: string; from: string; date: string; body: string }[];
};

export function MailScreen({
  connected,
  email,
  databases,
  initialThreads,
  initialError,
}: {
  connected: boolean;
  email: string | null;
  databases: { id: string; title: string }[];
  initialThreads: ThreadSummary[] | null;
  initialError: string | null;
}) {
  const [threads, setThreads] = useState<ThreadSummary[] | null>(initialThreads);
  const [selected, setSelected] = useState<ThreadDetail | null>(null);
  const [error, setError] = useState<string | null>(initialError);
  const [loading, setLoading] = useState(false);
  const [databaseId, setDatabaseId] = useState(databases[0]?.id ?? "");
  const [taskStatus, setTaskStatus] = useState<string | null>(null);

  const refresh = () => {
    setLoading(true);
    setError(null);
    void (async () => {
      const response = await fetch("/api/gmail/threads");
      const data = await response.json();
      if (response.ok) setThreads(data.threads ?? []);
      else setError(data.error);
      setLoading(false);
    })();
  };

  const openThread = async (threadId: string) => {
    setTaskStatus(null);
    const response = await fetch(`/api/gmail/threads?id=${threadId}`);
    const data = await response.json();
    if (response.ok) setSelected(data);
    else setError(data.error);
  };

  const makeTask = async () => {
    if (!selected || !databaseId) return;
    setTaskStatus("Creating…");
    const response = await fetch("/api/gmail/task", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ threadId: selected.threadId, databaseId }),
    });
    const data = await response.json();
    setTaskStatus(
      response.ok ? "Created — open it from the sidebar database." : `Failed: ${data.error}`,
    );
  };

  if (!connected) {
    return (
      <div className="mx-auto max-w-2xl px-8 py-12">
        <h1 className="mb-4 flex items-center gap-2 text-2xl font-bold">
          <Mail className="h-5 w-5" /> Mail
        </h1>
        <div className="rounded-lg border p-4 text-sm">
          <p className="mb-3 text-muted-foreground">
            Connect Gmail to read your inbox here and turn threads into rows.
            Read-only access.
          </p>
          <Button asChild size="sm">
            <a href="/api/google/auth?kind=gmail">Connect Gmail</a>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full">
      <div className="flex w-80 shrink-0 flex-col border-r">
        <div className="flex items-center gap-2 border-b p-3">
          <span className="truncate text-sm font-medium">{email}</span>
          <Button
            variant="ghost"
            size="icon"
            className="ml-auto h-7 w-7"
            aria-label="Refresh inbox"
            onClick={refresh}
          >
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {error ? <p className="p-3 text-sm text-destructive">{error}</p> : null}
          {loading ? (
            <p className="p-3 text-sm text-muted-foreground">Loading…</p>
          ) : null}
          {(threads ?? []).map((thread) => (
            <button
              key={thread.threadId}
              type="button"
              onClick={() => void openThread(thread.threadId)}
              className={cn(
                "flex w-full flex-col items-start gap-0.5 border-b px-3 py-2 text-left hover:bg-muted/50",
                selected?.threadId === thread.threadId && "bg-muted",
              )}
            >
              <span className="flex w-full items-center gap-2">
                <span className={cn("truncate text-sm", thread.unread && "font-semibold")}>
                  {thread.fromName}
                </span>
                {thread.messageCount > 1 ? (
                  <span className="text-xs text-muted-foreground">{thread.messageCount}</span>
                ) : null}
                <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
                  {thread.date ? new Date(thread.date).toLocaleDateString() : ""}
                </span>
              </span>
              <span className={cn("truncate text-sm", thread.unread && "font-medium")}>
                {thread.subject}
              </span>
              <span className="line-clamp-1 text-xs text-muted-foreground">{thread.snippet}</span>
            </button>
          ))}
          {threads?.length === 0 ? (
            <p className="p-3 text-sm text-muted-foreground">Inbox is empty.</p>
          ) : null}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {selected ? (
          <div className="mx-auto max-w-2xl px-8 py-8">
            <h1 className="mb-4 text-2xl font-bold">{selected.subject}</h1>
            <div className="mb-6 flex flex-wrap items-center gap-2 rounded-md border p-3 text-sm">
              <span className="text-muted-foreground">Turn into a row in</span>
              <select
                className="h-8 rounded-md border bg-transparent px-1"
                value={databaseId}
                onChange={(e) => setDatabaseId(e.target.value)}
              >
                {databases.map((d) => (
                  <option key={d.id} value={d.id}>{d.title}</option>
                ))}
              </select>
              <Button size="sm" disabled={!databaseId} onClick={() => void makeTask()}>
                Create row
              </Button>
              {taskStatus ? (
                <span className="text-xs text-muted-foreground">{taskStatus}</span>
              ) : null}
            </div>
            {selected.messages.map((message) => (
              <article key={message.id} className="mb-6 border-b pb-6 last:border-0">
                <header className="mb-2 flex items-baseline gap-2">
                  <span className="font-medium">{message.fromName}</span>
                  <span className="text-xs text-muted-foreground">{message.from}</span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {message.date ? new Date(message.date).toLocaleString() : ""}
                  </span>
                </header>
                <pre className="whitespace-pre-wrap font-sans text-sm leading-6">
                  {message.body}
                </pre>
              </article>
            ))}
          </div>
        ) : (
          <p className="p-8 text-sm text-muted-foreground">Select a thread to read it.</p>
        )}
      </div>
    </div>
  );
}
