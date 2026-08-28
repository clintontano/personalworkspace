import { describe, expect, it } from "vitest";
import {
  eventBody,
  eventDate,
  planPull,
  planPush,
  type GcalEvent,
  type SyncRow,
} from "./calendar-sync";

const row = (overrides: Partial<SyncRow>): SyncRow => ({
  pageId: "p1",
  title: "Row",
  date: "2026-09-01",
  updatedAt: "2026-08-28T10:00:00Z",
  gcal: null,
  archived: false,
  ...overrides,
});

describe("eventDate", () => {
  it("uses all-day date, falls back to dateTime's day", () => {
    expect(eventDate({ id: "e", start: { date: "2026-09-02" } })).toBe("2026-09-02");
    expect(eventDate({ id: "e", start: { dateTime: "2026-09-02T15:30:00+02:00" } })).toBe("2026-09-02");
    expect(eventDate({ id: "e" })).toBeNull();
  });
});

describe("planPull", () => {
  it("creates rows for unknown events", () => {
    const events: GcalEvent[] = [
      { id: "e1", summary: "Dentist", updated: "u1", start: { date: "2026-09-03" } },
    ];
    const actions = planPull(events, []);
    expect(actions).toEqual([
      { kind: "create", event: events[0], title: "Dentist", date: "2026-09-03" },
    ]);
  });

  it("updates linked rows when the event changed", () => {
    const events: GcalEvent[] = [
      { id: "e1", summary: "Dentist moved", updated: "u2", start: { date: "2026-09-04" } },
    ];
    const rows = [row({ pageId: "p1", title: "Dentist", gcal: { id: "e1", updated: "u1" } })];
    const actions = planPull(events, rows);
    expect(actions).toEqual([
      { kind: "update", pageId: "p1", title: "Dentist moved", date: "2026-09-04", gcal: { id: "e1", updated: "u2" } },
    ]);
  });

  it("skips linked rows already at the same state", () => {
    const events: GcalEvent[] = [
      { id: "e1", summary: "Dentist", updated: "u1", start: { date: "2026-09-01" } },
    ];
    const rows = [row({ title: "Dentist", date: "2026-09-01", gcal: { id: "e1", updated: "u1" } })];
    expect(planPull(events, rows)).toEqual([]);
  });

  it("archives rows for cancelled events", () => {
    const events: GcalEvent[] = [{ id: "e1", status: "cancelled" }];
    const rows = [row({ gcal: { id: "e1", updated: "u1" } })];
    expect(planPull(events, rows)).toEqual([{ kind: "archive", pageId: "p1" }]);
  });
});

describe("planPush", () => {
  it("inserts unlinked rows with dates, skips dateless ones", () => {
    const rows = [
      row({ pageId: "p1", date: "2026-09-01" }),
      row({ pageId: "p2", date: null }),
    ];
    expect(planPush(rows, null, new Set())).toEqual([
      { kind: "insert", pageId: "p1", title: "Row", date: "2026-09-01" },
    ]);
  });

  it("patches linked rows edited since last sync", () => {
    const rows = [
      row({ pageId: "p1", updatedAt: "2026-08-28T12:00:00Z", gcal: { id: "e1" } }),
      row({ pageId: "p2", updatedAt: "2026-08-28T08:00:00Z", gcal: { id: "e2" } }),
    ];
    expect(planPush(rows, "2026-08-28T10:00:00Z", new Set())).toEqual([
      { kind: "patch", pageId: "p1", eventId: "e1", title: "Row", date: "2026-09-01" },
    ]);
  });

  it("never pushes rows the pull just wrote", () => {
    const rows = [row({ pageId: "p1", updatedAt: "2026-08-28T12:00:00Z", gcal: { id: "e1" } })];
    expect(planPush(rows, "2026-08-28T10:00:00Z", new Set(["p1"]))).toEqual([]);
  });
});

describe("eventBody", () => {
  it("builds an all-day event with exclusive end date", () => {
    expect(eventBody("Trip", "2026-09-01")).toEqual({
      summary: "Trip",
      start: { date: "2026-09-01" },
      end: { date: "2026-09-02" },
    });
  });

  it("omits start/end when the date did not move", () => {
    expect(eventBody("Renamed", null)).toEqual({ summary: "Renamed" });
  });
});
