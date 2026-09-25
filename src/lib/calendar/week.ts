/**
 * Week math for week views. Weeks run Monday to Sunday and are numbered from
 * a fixed anchor date, so "Week 1" means the same thing after a replan: move
 * the anchor and every week renumbers itself. Nothing is stored per row.
 *
 * All arithmetic is done on UTC midnights built from the date parts. A plain
 * "2026-09-21" parsed by `new Date` is UTC midnight, which is the previous
 * day west of Greenwich, and that would put rows in the wrong week.
 */

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

/** A row spanning longer than this is clamped, so one bad date cannot render years of sections. */
const MAX_SPAN_WEEKS = 53;

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export type WeekSpan = {
  /** 1-based, counted from the anchor week. Weeks before the anchor are 0 and below. */
  index: number;
  /** yyyy-mm-dd, the Monday */
  start: string;
  /** yyyy-mm-dd, the Sunday */
  end: string;
  isCurrent: boolean;
};

export type WeekPlacement = {
  index: number;
  /** false when the row started in an earlier week and is still running */
  isStart: boolean;
};

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** yyyy-mm-dd (or a full ISO value) -> UTC midnight, or null if unparseable. */
function toUtcDay(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return null;
  const ms = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(ms) ? null : ms;
}

function toDay(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** Today as yyyy-mm-dd in the viewer's own timezone, not UTC. */
export function todayIso(now = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** The Monday of the week containing a date. Returns null for unparseable input. */
export function mondayOf(value: unknown): string | null {
  const ms = toUtcDay(value);
  if (ms === null) return null;
  // getUTCDay(): 0=Sun..6=Sat -> days since Monday
  const offset = (new Date(ms).getUTCDay() + 6) % 7;
  return toDay(ms - offset * DAY_MS);
}

/**
 * Which week a date falls in. 1 is the anchor's own week, 2 the next, 0 the
 * one before. Returns null when either date is unparseable.
 */
export function weekIndex(value: unknown, anchor: string): number | null {
  const day = mondayOf(value);
  const base = mondayOf(anchor);
  if (day === null || base === null) return null;
  return Math.round((toUtcDay(day)! - toUtcDay(base)!) / WEEK_MS) + 1;
}

/** The Monday-to-Sunday span of a given week number. */
export function weekSpan(index: number, anchor: string, today = todayIso()): WeekSpan {
  const base = toUtcDay(mondayOf(anchor) ?? anchor);
  const start = (base ?? 0) + (index - 1) * WEEK_MS;
  return {
    index,
    start: toDay(start),
    end: toDay(start + 6 * DAY_MS),
    isCurrent: weekIndex(today, anchor) === index,
  };
}

/** "Sep 21 – 27" within one month, "Sep 28 – Oct 4" across two. */
export function weekLabel(span: WeekSpan): string {
  const [, sm, sd] = span.start.split("-").map(Number);
  const [, em, ed] = span.end.split("-").map(Number);
  const from = `${MONTHS[sm - 1]} ${sd}`;
  return sm === em ? `${from} – ${ed}` : `${from} – ${MONTHS[em - 1]} ${ed}`;
}

/**
 * Every week a row occupies. A row with only a start date sits in one week;
 * one that runs to a later end date appears in each week it overlaps, so a
 * task running Wednesday to the following Tuesday is visible in both.
 */
export function placementsFor(
  start: unknown,
  end: unknown,
  anchor: string,
): WeekPlacement[] {
  const first = weekIndex(start, anchor);
  if (first === null) return [];
  const last = weekIndex(end, anchor);
  if (last === null || last <= first) return [{ index: first, isStart: true }];

  const placements: WeekPlacement[] = [];
  const stop = Math.min(last, first + MAX_SPAN_WEEKS - 1);
  for (let i = first; i <= stop; i++) {
    placements.push({ index: i, isStart: i === first });
  }
  return placements;
}

/**
 * The inclusive run of week numbers to render: every week holding a row, and
 * always through the current week, so an empty stretch ahead still shows the
 * week you are in. Falls back to the current week alone when nothing is dated.
 */
export function weekRange(
  occupied: number[],
  anchor: string,
  today = todayIso(),
): number[] {
  const current = weekIndex(today, anchor) ?? 1;
  const marks = [...occupied, current, 1];
  const from = Math.min(...marks);
  const to = Math.max(...marks);
  const out: number[] = [];
  for (let i = from; i <= to; i++) out.push(i);
  return out;
}
