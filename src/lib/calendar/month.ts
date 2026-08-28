/** Month-grid math for calendar views. Weeks start on Monday. */

export type DayCell = {
  /** yyyy-mm-dd */
  date: string;
  inMonth: boolean;
  isToday: boolean;
};

export function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * A 4-6 week grid covering the given month, padded to full Monday-Sunday
 * weeks with the neighbouring months' days.
 */
export function monthGrid(year: number, month: number, today = new Date()): DayCell[][] {
  const first = new Date(year, month - 1, 1);
  // getDay(): 0=Sun..6=Sat → offset from Monday
  const lead = (first.getDay() + 6) % 7;
  const start = new Date(year, month - 1, 1 - lead);
  const todayIso = isoDate(today);

  const weeks: DayCell[][] = [];
  const cursor = new Date(start);
  do {
    const week: DayCell[] = [];
    for (let i = 0; i < 7; i++) {
      week.push({
        date: isoDate(cursor),
        inMonth: cursor.getMonth() === month - 1,
        isToday: isoDate(cursor) === todayIso,
      });
      cursor.setDate(cursor.getDate() + 1);
    }
    weeks.push(week);
  } while (cursor.getMonth() === month - 1);

  return weeks;
}

export function monthLabel(year: number, month: number): string {
  return new Date(year, month - 1, 1).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
}

export function addMonths(year: number, month: number, delta: number): { year: number; month: number } {
  const d = new Date(year, month - 1 + delta, 1);
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}
