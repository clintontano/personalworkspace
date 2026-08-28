/**
 * Minimal cron matching for scheduled automations: five fields
 * (minute hour day-of-month month day-of-week) supporting *, lists, ranges
 * and step values. Evaluated against a Date in the runner's timezone.
 */

function matchField(field: string, value: number): boolean {
  return field.split(",").some((part) => {
    const [range, stepRaw] = part.split("/");
    const step = stepRaw ? Number(stepRaw) : 1;
    if (!Number.isFinite(step) || step < 1) return false;

    if (range === "*") return value % step === 0;

    const [startRaw, endRaw] = range.split("-");
    const start = Number(startRaw);
    if (!Number.isFinite(start)) return false;
    const end = endRaw !== undefined ? Number(endRaw) : start;
    if (!Number.isFinite(end)) return false;
    if (value < start || value > end) return false;
    return (value - start) % step === 0;
  });
}

/** True when `date` falls on a minute the expression selects. */
export function cronMatches(expression: string, date: Date): boolean {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) return false;
  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields;

  return (
    matchField(minute, date.getMinutes()) &&
    matchField(hour, date.getHours()) &&
    matchField(dayOfMonth, date.getDate()) &&
    matchField(month, date.getMonth() + 1) &&
    matchField(dayOfWeek, date.getDay())
  );
}

/** Has a full minute boundary passed since the last run? Prevents a rule
 * firing repeatedly within the same minute when the runner ticks often. */
export function shouldRunNow(
  expression: string,
  now: Date,
  lastRunAt: string | null,
): boolean {
  if (!cronMatches(expression, now)) return false;
  if (!lastRunAt) return true;
  const last = new Date(lastRunAt);
  return (
    last.getFullYear() !== now.getFullYear() ||
    last.getMonth() !== now.getMonth() ||
    last.getDate() !== now.getDate() ||
    last.getHours() !== now.getHours() ||
    last.getMinutes() !== now.getMinutes()
  );
}
