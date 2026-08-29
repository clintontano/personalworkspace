import { describe, expect, it } from "vitest";
import type { Property } from "@/lib/db/model";
import { coerceValue, resolveProperty } from "./api";

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
