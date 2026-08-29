import { describe, expect, it } from "vitest";
import {
  datePart,
  formatTime,
  fromLocalInput,
  hasTime,
  normalizeDateValue,
  toInstant,
  toLocalInput,
} from "./date-value";

describe("hasTime", () => {
  it("distinguishes all-day from timed values", () => {
    expect(hasTime("2026-08-29")).toBe(false);
    expect(hasTime("2026-08-29T10:00:00Z")).toBe(true);
    expect(hasTime("2026-08-29T12:00:00+02:00")).toBe(true);
  });

  it("rejects non-strings and empty values", () => {
    expect(hasTime(null)).toBe(false);
    expect(hasTime(undefined)).toBe(false);
    expect(hasTime("")).toBe(false);
  });
});

describe("datePart", () => {
  it("extracts the calendar day from both forms", () => {
    expect(datePart("2026-08-29")).toBe("2026-08-29");
    expect(datePart("2026-08-29T23:30:00Z")).toBe("2026-08-29");
  });

  it("returns null for junk", () => {
    expect(datePart("")).toBeNull();
    expect(datePart(42)).toBeNull();
  });
});

describe("toInstant", () => {
  it("orders a timed value after the same day's all-day value", () => {
    const allDay = toInstant("2026-08-29")!;
    const timed = toInstant("2026-08-29T10:00:00Z")!;
    expect(allDay).toBeLessThan(timed);
  });

  it("compares across UTC offsets by instant, not string order", () => {
    // 12:00+02:00 is 10:00Z, which is earlier than 11:00Z despite sorting later
    const plusTwo = toInstant("2026-08-29T12:00:00+02:00")!;
    const utc = toInstant("2026-08-29T11:00:00Z")!;
    expect(plusTwo).toBeLessThan(utc);
    expect("2026-08-29T12:00:00+02:00" > "2026-08-29T11:00:00Z").toBe(true);
  });

  it("returns null for unparseable input", () => {
    expect(toInstant("not a date")).toBeNull();
    expect(toInstant(null)).toBeNull();
  });
});

describe("local input round trip", () => {
  it("survives datetime-local -> stored -> datetime-local", () => {
    const local = "2026-08-29T14:30";
    const stored = fromLocalInput(local)!;
    expect(hasTime(stored)).toBe(true);
    expect(toLocalInput(stored)).toBe(local);
  });

  it("offers a sensible default time when adding one to an all-day value", () => {
    expect(toLocalInput("2026-08-29")).toBe("2026-08-29T09:00");
  });

  it("handles empty input", () => {
    expect(fromLocalInput("")).toBeNull();
    expect(toLocalInput(null)).toBe("");
  });
});

describe("formatTime", () => {
  it("is empty for all-day values", () => {
    expect(formatTime("2026-08-29")).toBe("");
  });

  it("renders a time for timed values", () => {
    expect(formatTime(fromLocalInput("2026-08-29T14:30")!, "en-US")).toMatch(/2:30/);
  });
});

describe("normalizeDateValue", () => {
  it("keeps all-day values as plain dates", () => {
    expect(normalizeDateValue("2026-08-29")).toBe("2026-08-29");
  });

  it("keeps the time when one is present", () => {
    expect(normalizeDateValue("2026-08-29T10:00:00Z")).toBe("2026-08-29T10:00:00.000Z");
  });

  it("truncates a longer date-only string to the day", () => {
    expect(normalizeDateValue("2026-08-29 extra")).toBe("2026-08-29");
  });

  it("rejects rubbish", () => {
    expect(normalizeDateValue("")).toBeNull();
    expect(normalizeDateValue("hello")).toBeNull();
    expect(normalizeDateValue(null)).toBeNull();
  });
});
