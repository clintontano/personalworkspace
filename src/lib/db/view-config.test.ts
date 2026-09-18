import { describe, expect, it } from "vitest";
import type { ViewConfig } from "./data";
import { configMentions, withoutProperty } from "./view-config";

const DELETED = "prop-status";
const KEPT = "prop-due";

describe("withoutProperty", () => {
  it("drops conditions on the deleted property and keeps the rest", () => {
    const config: ViewConfig = {
      filter: {
        combinator: "and",
        conditions: [
          { property: DELETED, op: "eq", value: "done" },
          { property: KEPT, op: "before", value: "2026-01-01" },
        ],
      },
    };
    expect(withoutProperty(config, DELETED).filter).toEqual({
      combinator: "and",
      conditions: [{ property: KEPT, op: "before", value: "2026-01-01" }],
    });
  });

  it("recurses into nested groups", () => {
    const config: ViewConfig = {
      filter: {
        combinator: "or",
        conditions: [
          {
            combinator: "and",
            conditions: [
              { property: DELETED, op: "eq", value: "done" },
              { property: KEPT, op: "is_not_empty" },
            ],
          },
        ],
      },
    };
    expect(withoutProperty(config, DELETED).filter).toEqual({
      combinator: "or",
      conditions: [{ combinator: "and", conditions: [{ property: KEPT, op: "is_not_empty" }] }],
    });
  });

  it("removes a nested group left empty rather than keeping it", () => {
    // An empty group evaluates to true, which inside an `or` would widen the
    // filter to every row — the opposite of what the view said.
    const config: ViewConfig = {
      filter: {
        combinator: "or",
        conditions: [
          { combinator: "and", conditions: [{ property: DELETED, op: "eq", value: "done" }] },
          { property: KEPT, op: "is_not_empty" },
        ],
      },
    };
    expect(withoutProperty(config, DELETED).filter).toEqual({
      combinator: "or",
      conditions: [{ property: KEPT, op: "is_not_empty" }],
    });
  });

  it("clears sorts, grouping, hidden lists, the date property and column widths", () => {
    const config: ViewConfig = {
      sorts: [
        { property: DELETED, direction: "asc" },
        { property: KEPT, direction: "desc" },
      ],
      groupBy: DELETED,
      dateProperty: DELETED,
      hidden: [DELETED, KEPT],
      columnWidths: { [DELETED]: 120, [KEPT]: 200, title: 300 },
    };
    expect(withoutProperty(config, DELETED)).toEqual({
      sorts: [{ property: KEPT, direction: "desc" }],
      hidden: [KEPT],
      columnWidths: { [KEPT]: 200, title: 300 },
    });
  });

  it("leaves a config that never mentions the property untouched", () => {
    const config: ViewConfig = {
      sorts: [{ property: KEPT, direction: "asc" }],
      groupBy: KEPT,
      columnWidths: { title: 300 },
    };
    expect(withoutProperty(config, DELETED)).toEqual(config);
    expect(configMentions(config, DELETED)).toBe(false);
  });

  it("reports a mention so a no-op write can be skipped", () => {
    expect(configMentions({ groupBy: DELETED }, DELETED)).toBe(true);
    expect(configMentions({}, DELETED)).toBe(false);
  });
});
