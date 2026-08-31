/**
 * Google Calendar <-> database-rows sync planning. Pure logic, unit-tested;
 * the API calls live in the sync route.
 *
 * A synced row carries a `_gcal` marker inside its properties jsonb:
 *   { id: <google event id>, updated: <google updated timestamp> }
 * Reserved underscore keys are ignored by the UI (it renders only defined
 * property ids).
 *
 * Sync order per run: pull first (remote wins for remotely-changed events),
 * then push local rows edited since the last run and untouched by the pull.
 * Date-only mapping: timed events are placed on their start date; pushes only
 * rewrite start/end when the date actually moved, so event times survive
 * local edits that do not move the day.
 */

export type GcalEvent = {
  id: string;
  status?: string;
  summary?: string;
  updated?: string;
  start?: { date?: string; dateTime?: string };
  end?: { date?: string; dateTime?: string };
};

export type SyncRow = {
  pageId: string;
  title: string;
  date: string | null; // yyyy-mm-dd from the date property
  updatedAt: string;
  gcal: { id: string; updated?: string } | null;
  archived: boolean;
};

export type PullAction =
  | { kind: "create"; event: GcalEvent; title: string; date: string | null }
  | { kind: "update"; pageId: string; title: string; date: string | null; gcal: { id: string; updated?: string } }
  | { kind: "archive"; pageId: string };

export type PushAction =
  | { kind: "insert"; pageId: string; title: string; date: string }
  | { kind: "patch"; pageId: string; eventId: string; title: string; date: string | null };

/**
 * The stored value for an event: the plain day for all-day events, the full
 * timestamp for timed ones, so a round trip does not flatten a 10:00 meeting
 * into an all-day block.
 */
export function eventDate(event: GcalEvent): string | null {
  const start = event.start;
  if (!start) return null;
  if (start.date) return start.date;
  if (start.dateTime) {
    const parsed = new Date(start.dateTime);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  return null;
}

/** Milliseconds between an event's start and end, when both are timed. */
export function eventDuration(event: GcalEvent): number | null {
  const start = event.start?.dateTime;
  const end = event.end?.dateTime;
  if (!start || !end) return null;
  const ms = new Date(end).getTime() - new Date(start).getTime();
  return Number.isFinite(ms) && ms > 0 ? ms : null;
}

/** Decide what to do locally for each remotely-changed event. */
export function planPull(events: GcalEvent[], rows: SyncRow[]): PullAction[] {
  const byGcalId = new Map(rows.filter((r) => r.gcal).map((r) => [r.gcal!.id, r]));
  const actions: PullAction[] = [];

  for (const event of events) {
    const row = byGcalId.get(event.id);
    if (event.status === "cancelled") {
      if (row && !row.archived) actions.push({ kind: "archive", pageId: row.pageId });
      continue;
    }
    const title = event.summary ?? "";
    const date = eventDate(event);
    if (!row) {
      actions.push({ kind: "create", event, title, date });
    } else if (
      row.title !== title ||
      row.date !== date ||
      row.gcal?.updated !== event.updated
    ) {
      actions.push({
        kind: "update",
        pageId: row.pageId,
        title,
        date,
        gcal: { id: event.id, updated: event.updated },
      });
    }
  }
  return actions;
}

/**
 * Decide what to push. Only rows edited after `lastSyncAt` and not touched by
 * this run's pull; rows without a date are skipped (nothing to place).
 */
export function planPush(
  rows: SyncRow[],
  lastSyncAt: string | null,
  pulledPageIds: Set<string>,
): PushAction[] {
  const actions: PushAction[] = [];
  for (const row of rows) {
    if (row.archived || pulledPageIds.has(row.pageId)) continue;
    if (lastSyncAt && row.updatedAt <= lastSyncAt) continue;
    if (!row.gcal) {
      if (row.date) actions.push({ kind: "insert", pageId: row.pageId, title: row.title, date: row.date });
    } else {
      actions.push({
        kind: "patch",
        pageId: row.pageId,
        eventId: row.gcal.id,
        title: row.title,
        date: row.date,
      });
    }
  }
  return actions;
}

/**
 * A timed row with no known duration becomes a point in time rather than a
 * padded block: a task due at 2pm is due at 2pm, it does not occupy 2–3pm.
 * Google accepts an event whose end equals its start and shows it as a single
 * moment. Existing events keep their real duration — see eventDuration, which
 * the patch path reads before writing.
 */
export const DEFAULT_EVENT_MS = 0;

/**
 * Event body for an insert/patch.
 *
 * A value with a time produces a timed event: it keeps the event's existing
 * duration when one is known, and is otherwise a point in time rather than an
 * invented block. A plain day produces an all-day event with the exclusive
 * end date Google expects. A null value touches only the title, leaving the
 * event's existing schedule alone.
 */
export function eventBody(
  title: string,
  value: string | null,
  durationMs: number | null = null,
): Record<string, unknown> {
  const body: Record<string, unknown> = { summary: title };
  if (!value) return body;

  if (value.length > 10 && value.includes("T")) {
    const start = new Date(value);
    if (Number.isNaN(start.getTime())) return body;
    const end = new Date(start.getTime() + (durationMs ?? DEFAULT_EVENT_MS));
    body.start = { dateTime: start.toISOString() };
    body.end = { dateTime: end.toISOString() };
    return body;
  }

  const day = value.slice(0, 10);
  const next = new Date(day + "T00:00:00Z");
  next.setUTCDate(next.getUTCDate() + 1);
  body.start = { date: day };
  body.end = { date: next.toISOString().slice(0, 10) };
  return body;
}
