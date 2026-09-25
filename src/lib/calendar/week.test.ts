import { describe, expect, it } from "vitest";
import {
  mondayOf,
  placementsFor,
  weekIndex,
  weekLabel,
  weekRange,
  weekSpan,
} from "./week";

/** Week 1 of the current plan. */
const ANCHOR = "2026-09-21";

describe("mondayOf", () => {
  it("returns the Monday of the containing week", () => {
    expect(mondayOf("2026-09-21")).toBe("2026-09-21"); // Monday itself
    expect(mondayOf("2026-09-25")).toBe("2026-09-21"); // Friday
    expect(mondayOf("2026-09-27")).toBe("2026-09-21"); // Sunday closes the week
    expect(mondayOf("2026-09-28")).toBe("2026-09-28"); // next Monday
  });

  it("reads the day from full ISO values and rejects junk", () => {
    expect(mondayOf("2026-09-25T14:30:00Z")).toBe("2026-09-21");
    expect(mondayOf("")).toBeNull();
    expect(mondayOf(null)).toBeNull();
    expect(mondayOf(undefined)).toBeNull();
    expect(mondayOf(42)).toBeNull();
  });

  it("crosses a month and a year boundary", () => {
    expect(mondayOf("2026-10-01")).toBe("2026-09-28");
    expect(mondayOf("2027-01-01")).toBe("2026-12-28");
  });
});

describe("weekIndex", () => {
  it("numbers from the anchor week", () => {
    expect(weekIndex("2026-09-21", ANCHOR)).toBe(1);
    expect(weekIndex("2026-09-27", ANCHOR)).toBe(1);
    expect(weekIndex("2026-09-28", ANCHOR)).toBe(2);
    expect(weekIndex("2026-10-05", ANCHOR)).toBe(3);
    expect(weekIndex("2026-12-28", ANCHOR)).toBe(15);
  });

  it("goes non-positive before the anchor", () => {
    expect(weekIndex("2026-09-18", ANCHOR)).toBe(0);
    expect(weekIndex("2026-09-07", ANCHOR)).toBe(-1);
  });

  it("is unaffected by a mid-week anchor", () => {
    expect(weekIndex("2026-09-28", "2026-09-23")).toBe(2);
  });

  it("returns null when either side is unparseable", () => {
    expect(weekIndex(null, ANCHOR)).toBeNull();
    expect(weekIndex("2026-09-21", "not a date")).toBeNull();
  });
});

describe("weekSpan", () => {
  it("runs Monday to Sunday", () => {
    expect(weekSpan(1, ANCHOR, "2026-09-25")).toEqual({
      index: 1,
      start: "2026-09-21",
      end: "2026-09-27",
      isCurrent: true,
    });
    expect(weekSpan(2, ANCHOR, "2026-09-25")).toEqual({
      index: 2,
      start: "2026-09-28",
      end: "2026-10-04",
      isCurrent: false,
    });
  });

  it("carries over the year end", () => {
    expect(weekSpan(16, ANCHOR, "2026-09-25").start).toBe("2027-01-04");
  });
});

describe("weekLabel", () => {
  it("collapses the month when the week stays inside it", () => {
    expect(weekLabel(weekSpan(1, ANCHOR))).toBe("Sep 21 – 27");
  });

  it("names both months when the week straddles them", () => {
    expect(weekLabel(weekSpan(2, ANCHOR))).toBe("Sep 28 – Oct 4");
  });
});

describe("placementsFor", () => {
  it("places a single-date row in one week", () => {
    expect(placementsFor("2026-09-25", null, ANCHOR)).toEqual([
      { index: 1, isStart: true },
    ]);
  });

  it("repeats a row across every week it overlaps", () => {
    expect(placementsFor("2026-09-23", "2026-10-06", ANCHOR)).toEqual([
      { index: 1, isStart: true },
      { index: 2, isStart: false },
      { index: 3, isStart: false },
    ]);
  });

  it("treats an end date inside the start week as no span", () => {
    expect(placementsFor("2026-09-21", "2026-09-25", ANCHOR)).toEqual([
      { index: 1, isStart: true },
    ]);
  });

  it("ignores an end date that precedes the start", () => {
    expect(placementsFor("2026-10-05", "2026-09-01", ANCHOR)).toEqual([
      { index: 3, isStart: true },
    ]);
  });

  it("clamps an absurd span instead of rendering years of weeks", () => {
    const placements = placementsFor("2026-09-21", "2099-01-01", ANCHOR);
    expect(placements).toHaveLength(53);
    expect(placements[0]).toEqual({ index: 1, isStart: true });
  });

  it("returns nothing without a start date", () => {
    expect(placementsFor(null, "2026-10-06", ANCHOR)).toEqual([]);
    expect(placementsFor("", null, ANCHOR)).toEqual([]);
  });
});

describe("weekRange", () => {
  it("covers every occupied week and always reaches today", () => {
    expect(weekRange([3, 5], ANCHOR, "2026-09-25")).toEqual([1, 2, 3, 4, 5]);
  });

  it("falls back to week 1 through today when nothing is dated", () => {
    expect(weekRange([], ANCHOR, "2026-10-05")).toEqual([1, 2, 3]);
  });

  it("extends backwards for rows scheduled before the anchor", () => {
    expect(weekRange([-1], ANCHOR, "2026-09-25")).toEqual([-1, 0, 1]);
  });
});
