import { describe, expect, it } from "vitest";
import type { Property } from "@/lib/db/model";
import { coerceValue, resolveProperty, withMissingOptions } from "./api";

const status: Property = {
  id: "prop-status",
  name: "Status",
  type: "select",
  order_key: "a0",
  config: {
    options: [
      { id: "todo", name: "To do", color: "gray" },
      { id: "done", name: "Done", color: "green" },
    ],
  },
};
const tags: Property = {
  id: "prop-tags",
  name: "Tags",
  type: "multi_select",
  order_key: "a1",
  config: { options: [{ id: "work", name: "Work", color: "blue" }] },
};
const estimate: Property = { id: "prop-est", name: "Estimate", type: "number", config: {}, order_key: "a2" };
const flag: Property = { id: "prop-flag", name: "Flagged", type: "checkbox", config: {}, order_key: "a3" };
const due: Property = { id: "prop-due", name: "Due", type: "date", config: {}, order_key: "a4" };

const all = [status, tags, estimate, flag, due];

describe("resolveProperty", () => {
  it("resolves by id", () => {
    expect(resolveProperty(all, "prop-status")).toBe(status);
  });

  it("resolves by name, case-insensitively", () => {
    expect(resolveProperty(all, "status")).toBe(status);
    expect(resolveProperty(all, "STATUS")).toBe(status);
  });

  it("returns undefined for an unknown reference", () => {
    expect(resolveProperty(all, "nope")).toBeUndefined();
  });
});

describe("coerceValue", () => {
  it("maps a select option name to its id", () => {
    expect(coerceValue(status, "Done")).toBe("done");
    expect(coerceValue(status, "done")).toBe("done");
  });

  it("maps multi-select names to ids and wraps scalars", () => {
    expect(coerceValue(tags, ["Work"])).toEqual(["work"]);
    expect(coerceValue(tags, "Work")).toEqual(["work"]);
    expect(coerceValue(tags, null)).toEqual([]);
  });

  it("keeps unknown option values rather than dropping them", () => {
    expect(coerceValue(status, "Blocked")).toBe("Blocked");
  });

  it("coerces numbers, checkboxes and dates", () => {
    expect(coerceValue(estimate, "5")).toBe(5);
    expect(coerceValue(estimate, "")).toBeNull();
    expect(coerceValue(flag, "true")).toBe(true);
    expect(coerceValue(flag, false)).toBe(false);
    expect(coerceValue(due, "2026-09-01")).toBe("2026-09-01");
    // a supplied time is preserved rather than truncated away
    expect(coerceValue(due, "2026-09-01T10:00:00Z")).toBe("2026-09-01T10:00:00.000Z");
    expect(coerceValue(due, "")).toBeNull();
  });
});

describe("withMissingOptions", () => {
  const week: Property = {
    id: "prop-week",
    name: "Week",
    type: "select",
    order_key: "a5",
    config: { options: [{ id: "week-13-sep-28-oct-4", name: "Week 13 (Sep 28–Oct 4)", color: "blue" }] },
  };

  it("adds an option for a label the select lacks, so the value can be stored as an id", () => {
    // the Goals Tracker regression: "Week 3 (Oct 5–11)" was stored as raw
    // text that no cell or board could read back
    const { property, added } = withMissingOptions(week, "Week 3 (Oct 5–11)");
    expect(added).toEqual([{ id: "week-3-oct-5-11", name: "Week 3 (Oct 5–11)", color: "green" }]);
    expect(coerceValue(property, "Week 3 (Oct 5–11)")).toBe("week-3-oct-5-11");
  });

  it("adds nothing when the label or id already exists, whatever its case", () => {
    expect(withMissingOptions(week, "week 13 (sep 28–oct 4)").added).toEqual([]);
    expect(withMissingOptions(week, "week-13-sep-28-oct-4").added).toEqual([]);
    expect(withMissingOptions(status, "Done").added).toEqual([]);
  });

  it("adds each new multi-select label once and keeps ids unique", () => {
    const { added } = withMissingOptions(tags, ["Home", "home", "Errands", "Work"]);
    expect(added.map((o) => o.name)).toEqual(["Home", "Errands"]);

    const clash: Property = { ...tags, config: { options: [{ id: "home", name: "Old home", color: "gray" }] } };
    expect(withMissingOptions(clash, "Home").added[0].id).toBe("home-2");
  });

  it("leaves non-select properties and empty values alone", () => {
    expect(withMissingOptions(estimate, "12").added).toEqual([]);
    expect(withMissingOptions(status, "").added).toEqual([]);
    expect(withMissingOptions(status, null).added).toEqual([]);
  });
});
