import { describe, expect, it } from "vitest";
import { cronMatches, shouldRunNow } from "./schedule";

const at = (iso: string) => new Date(iso);

describe("cronMatches", () => {
  it("matches an exact daily time", () => {
    expect(cronMatches("0 9 * * *", at("2026-08-28T09:00:00"))).toBe(true);
    expect(cronMatches("0 9 * * *", at("2026-08-28T09:01:00"))).toBe(false);
    expect(cronMatches("0 9 * * *", at("2026-08-28T10:00:00"))).toBe(false);
  });

  it("supports step values", () => {
    expect(cronMatches("*/15 * * * *", at("2026-08-28T09:30:00"))).toBe(true);
    expect(cronMatches("*/15 * * * *", at("2026-08-28T09:31:00"))).toBe(false);
  });

  it("supports ranges and lists", () => {
    // 2026-08-28 is a Friday (day 5)
    expect(cronMatches("0 9 * * 1-5", at("2026-08-28T09:00:00"))).toBe(true);
    expect(cronMatches("0 9 * * 6,0", at("2026-08-28T09:00:00"))).toBe(false);
    expect(cronMatches("0 9 * * 6,0", at("2026-08-29T09:00:00"))).toBe(true);
  });

  it("matches day of month and month fields", () => {
    expect(cronMatches("0 0 1 9 *", at("2026-09-01T00:00:00"))).toBe(true);
    expect(cronMatches("0 0 1 9 *", at("2026-08-01T00:00:00"))).toBe(false);
  });

  it("rejects malformed expressions", () => {
    expect(cronMatches("0 9 * *", at("2026-08-28T09:00:00"))).toBe(false);
    expect(cronMatches("", at("2026-08-28T09:00:00"))).toBe(false);
  });
});

describe("shouldRunNow", () => {
  it("runs when never run before", () => {
    expect(shouldRunNow("0 9 * * *", at("2026-08-28T09:00:00"), null)).toBe(true);
  });

  it("does not run twice in the same minute", () => {
    const now = at("2026-08-28T09:00:30");
    expect(shouldRunNow("0 9 * * *", now, "2026-08-28T09:00:05")).toBe(false);
  });

  it("runs again the next day", () => {
    expect(shouldRunNow("0 9 * * *", at("2026-08-29T09:00:00"), "2026-08-28T09:00:00")).toBe(true);
  });
});
