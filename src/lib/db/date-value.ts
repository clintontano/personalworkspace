/**
 * Date property values carry their own precision, so no schema change is
 * needed to support times:
 *
 *   all-day : "2026-08-29"
 *   timed   : "2026-08-29T10:00:00Z" / "2026-08-29T12:00:00+02:00"
 *
 * Existing all-day values keep working untouched. Comparisons are done on
 * instants rather than string order, because two values with different UTC
 * offsets do not sort lexicographically.
 */

export function hasTime(value: unknown): value is string {
  return typeof value === "string" && value.length > 10 && value.includes("T");
}

/** The calendar day a value falls on, for grouping and day-level filters. */
export function datePart(value: unknown): string | null {
  if (typeof value !== "string" || value.length < 10) return null;
  return value.slice(0, 10);
}

/** Sortable instant. All-day values sort at the start of their day. */
export function toInstant(value: unknown): number | null {
  if (typeof value !== "string" || value === "") return null;
  const parsed = Date.parse(hasTime(value) ? value : `${value}T00:00:00`);
  return Number.isNaN(parsed) ? null : parsed;
}

/** Value -> the string a <input type="datetime-local"> expects (local time). */
export function toLocalInput(value: unknown): string {
  if (!hasTime(value)) {
    const day = datePart(value);
    return day ? `${day}T09:00` : "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** <input type="datetime-local"> string -> stored ISO value with offset. */
export function fromLocalInput(local: string): string | null {
  if (!local) return null;
  const date = new Date(local);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/**
 * How a date reads in the UI: "Jan 1 2026", or "Jan 1 2026, 10:00 AM" when a
 * time is set. Built by hand rather than via toLocaleDateString because that
 * inserts a comma inside the date ("Jan 1, 2026").
 *
 * All-day values are formatted from their parts, never through a Date: a
 * plain "2026-01-01" parses as UTC midnight, which is the previous day west
 * of Greenwich and would show the wrong date.
 */
export function formatDateDisplay(value: unknown, locale?: string): string {
  const day = datePart(value);
  if (!day) return "";
  const [year, month, dayOfMonth] = day.split("-").map(Number);
  if (!year || !month || !dayOfMonth) return "";
  const formatted = `${MONTHS[month - 1]} ${dayOfMonth} ${year}`;
  const time = formatTime(value, locale);
  return time ? `${formatted}, ${time}` : formatted;
}

/** Human-readable time for chips and cells; empty for all-day values. */
export function formatTime(value: unknown, locale?: string): string {
  if (!hasTime(value)) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
}

/** Normalize anything date-ish into a stored value, preserving time. */
export function normalizeDateValue(value: unknown): string | null {
  if (typeof value !== "string" || value === "") return null;
  if (hasTime(value)) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  const day = datePart(value);
  return day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
}
