import { describe, expect, it } from "vitest";
import { addMonths, monthGrid } from "./month";

describe("monthGrid", () => {
  it("pads to full weeks starting Monday", () => {
    // August 2026 starts on a Saturday
    const grid = monthGrid(2026, 8, new Date(2026, 7, 28));
    expect(grid[0][0].date).toBe("2026-07-27"); // Monday before the 1st
    expect(grid[0][5].date).toBe("2026-08-01");
    expect(grid[0][5].inMonth).toBe(true);
    expect(grid[0][0].inMonth).toBe(false);
  });

  it("every week has exactly 7 days and covers the whole month", () => {
    const grid = monthGrid(2026, 2, new Date(2026, 0, 1));
    for (const week of grid) expect(week).toHaveLength(7);
    const inMonth = grid.flat().filter((d) => d.inMonth);
    expect(inMonth).toHaveLength(28);
    expect(inMonth[0].date).toBe("2026-02-01");
    expect(inMonth[27].date).toBe("2026-02-28");
  });

  it("marks today", () => {
    const grid = monthGrid(2026, 8, new Date(2026, 7, 28));
    const today = grid.flat().find((d) => d.isToday);
    expect(today?.date).toBe("2026-08-28");
  });

  it("addMonths wraps across year boundaries", () => {
    expect(addMonths(2026, 12, 1)).toEqual({ year: 2027, month: 1 });
    expect(addMonths(2026, 1, -1)).toEqual({ year: 2025, month: 12 });
  });
});
