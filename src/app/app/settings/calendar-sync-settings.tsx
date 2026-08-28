"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

type Target = {
  databaseId: string;
  title: string;
  dateProperties: { id: string; name: string }[];
};

export function CalendarSyncSettings({
  connected,
  email,
  targets,
  currentDatabaseId,
  currentDatePropertyId,
  lastSyncAt,
}: {
  connected: boolean;
  email: string | null;
  targets: Target[];
  currentDatabaseId: string | null;
  currentDatePropertyId: string | null;
  lastSyncAt: string | null;
}) {
  const [databaseId, setDatabaseId] = useState(
    currentDatabaseId ?? targets[0]?.databaseId ?? "",
  );
  const target = targets.find((t) => t.databaseId === databaseId);
  const [datePropertyId, setDatePropertyId] = useState(
    currentDatePropertyId ?? target?.dateProperties[0]?.id ?? "",
  );
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!connected) {
    return (
      <div className="text-sm">
        <p className="mb-3 text-muted-foreground">
          Connect your Google account to sync a database with your calendar.
        </p>
        <Button asChild size="sm">
          <a href="/api/google/auth?kind=calendar">Connect Google Calendar</a>
        </Button>
      </div>
    );
  }

  const syncNow = async () => {
    setBusy(true);
    setStatus(null);
    try {
      const response = await fetch("/api/google/sync", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ databaseId, datePropertyId }),
      });
      const data = await response.json();
      setStatus(
        response.ok
          ? data.resync
            ? "Sync token expired — run again for a full resync."
            : `Synced: ${data.pulled} pulled, ${data.pushed} pushed.`
          : `Failed: ${data.error}`,
      );
    } catch (err) {
      setStatus(`Failed: ${String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 text-sm">
      <p className="text-muted-foreground">
        Connected as <span className="font-medium text-foreground">{email}</span>
        {lastSyncAt ? ` · last synced ${new Date(lastSyncAt).toLocaleString()}` : ""}
      </p>
      <div className="flex items-center gap-2">
        <label className="text-muted-foreground">Sync database</label>
        <select
          className="h-8 rounded-md border bg-transparent px-1"
          value={databaseId}
          onChange={(e) => {
            setDatabaseId(e.target.value);
            const t = targets.find((x) => x.databaseId === e.target.value);
            setDatePropertyId(t?.dateProperties[0]?.id ?? "");
          }}
        >
          {targets.map((t) => (
            <option key={t.databaseId} value={t.databaseId}>{t.title}</option>
          ))}
        </select>
        <label className="text-muted-foreground">date property</label>
        <select
          className="h-8 rounded-md border bg-transparent px-1"
          value={datePropertyId}
          onChange={(e) => setDatePropertyId(e.target.value)}
        >
          {(target?.dateProperties ?? []).map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>
      <div className="flex items-center gap-3">
        <Button size="sm" disabled={busy || !databaseId || !datePropertyId} onClick={() => void syncNow()}>
          {busy ? "Syncing…" : "Sync now"}
        </Button>
        {status ? <span className="text-muted-foreground">{status}</span> : null}
      </div>
    </div>
  );
}
