import { describe, expect, it } from "vitest";
import { evaluateFilter, type FilterGroup } from "./filters";
import { groupRows } from "./group";
import type { Property, Row } from "./model";
import { sortRows } from "./sorts";

const props: Property[] = [
  { id: "status", name: "Status", type: "select", order_key: "a0",
    config: { options: [
      { id: "todo", name: "To do", color: "gray" },
      { id: "doing", name: "In progress", color: "blue" },
      { id: "done", name: "Done", color: "green" },
    ] } },
  { id: "due", name: "Due", type: "date", config: {}, order_key: "a1" },
  { id: "estimate", name: "Estimate", type: "number", config: {}, order_key: "a2" },
  { id: "flag", name: "Flagged", type: "checkbox", config: {}, order_key: "a3" },
  { id: "tags", name: "Tags", type: "multi_select", order_key: "a4",
    config: { options: [
      { id: "home", name: "Home", color: "red" },
      { id: "work", name: "Work", color: "purple" },
    ] } },
];
const byId = new Map(props.map((p) => [p.id, p]));

const mk = (
  pageId: string,
  title: string,
  properties: Row["properties"],
  orderKey = pageId,
): Row => ({
  pageId, title, icon: null, properties, orderKey,
  createdAt: "2026-01-01", updatedAt: "2026-01-01",
});

const rows = [
  mk("1", "Pay rent", { status: "todo", due: "2026-09-01", estimate: 1, flag: true, tags: ["home"] }),
  mk("2", "Ship phase 2", { status: "doing", due: "2026-08-30", estimate: 8, tags: ["work"] }),
  mk("3", "Read a book", { status: "done", estimate: 3, flag: false, tags: [] }),
  mk("4", "Untriaged thing", {}),
];

describe("evaluateFilter", () => {
  const run = (filter: FilterGroup) =>
    rows.filter((r) => evaluateFilter(r, filter, byId)).map((r) => r.pageId);

  it("empty filter matches everything", () => {
    expect(run({ combinator: "and", conditions: [] })).toEqual(["1", "2", "3", "4"]);
  });

  it("select eq", () => {
    expect(run({ combinator: "and", conditions: [{ property: "status", op: "eq", value: "doing" }] })).toEqual(["2"]);
  });

  it("title contains, case-insensitive", () => {
    expect(run({ combinator: "and", conditions: [{ property: "title", op: "contains", value: "PHASE" }] })).toEqual(["2"]);
  });

  it("date before", () => {
    expect(run({ combinator: "and", conditions: [{ property: "due", op: "before", value: "2026-08-31" }] })).toEqual(["2"]);
  });

  it("number gte", () => {
    expect(run({ combinator: "and", conditions: [{ property: "estimate", op: "gte", value: 3 }] })).toEqual(["2", "3"]);
  });

  it("checkbox eq true", () => {
    expect(run({ combinator: "and", conditions: [{ property: "flag", op: "eq", value: true }] })).toEqual(["1"]);
  });

  it("multi_select contains option id", () => {
    expect(run({ combinator: "and", conditions: [{ property: "tags", op: "contains", value: "work" }] })).toEqual(["2"]);
  });

  it("is_empty treats missing, empty string and empty array alike", () => {
    expect(run({ combinator: "and", conditions: [{ property: "due", op: "is_empty" }] })).toEqual(["3", "4"]);
    expect(run({ combinator: "and", conditions: [{ property: "tags", op: "is_empty" }] })).toEqual(["3", "4"]);
  });

  it("or combinator and nested groups", () => {
    expect(
      run({
        combinator: "or",
        conditions: [
          { property: "status", op: "eq", value: "done" },
          {
            combinator: "and",
            conditions: [
              { property: "status", op: "eq", value: "todo" },
              { property: "flag", op: "eq", value: true },
            ],
          },
        ],
      }),
    ).toEqual(["1", "3"]);
  });

  it("missing value never satisfies a comparison", () => {
    expect(run({ combinator: "and", conditions: [{ property: "estimate", op: "lt", value: 100 }] })).toEqual(["1", "2", "3"]);
  });
});

describe("sortRows", () => {
  const ids = (sorted: Row[]) => sorted.map((r) => r.pageId);

  it("sorts numbers ascending with empty last", () => {
    expect(ids(sortRows(rows, [{ property: "estimate", direction: "asc" }], byId))).toEqual(["1", "3", "2", "4"]);
  });

  it("sorts dates descending with empty last", () => {
    expect(ids(sortRows(rows, [{ property: "due", direction: "desc" }], byId))).toEqual(["1", "2", "3", "4"]);
  });

  it("sorts selects by option order, not name", () => {
    expect(ids(sortRows(rows, [{ property: "status", direction: "asc" }], byId))).toEqual(["1", "2", "3", "4"]);
    expect(ids(sortRows(rows, [{ property: "status", direction: "desc" }], byId))).toEqual(["3", "2", "1", "4"]);
  });

  it("secondary sort breaks ties", () => {
    const tied = [
      mk("a", "Bravo", { estimate: 1 }, "k1"),
      mk("b", "alpha", { estimate: 1 }, "k2"),
    ];
    expect(
      ids(sortRows(tied, [
        { property: "estimate", direction: "asc" },
        { property: "title", direction: "asc" },
      ], byId)),
    ).toEqual(["b", "a"]);
  });

  it("falls back to manual order key", () => {
    expect(ids(sortRows(rows, [], byId))).toEqual(["1", "2", "3", "4"]);
  });
});

describe("groupRows", () => {
  it("groups by select in option order with no-value last", () => {
    const groups = groupRows(rows, byId.get("status")!);
    expect(groups.map((g) => [g.label, g.rows.map((r) => r.pageId)])).toEqual([
      ["To do", ["1"]],
      ["In progress", ["2"]],
      ["Done", ["3"]],
      ["No value", ["4"]],
    ]);
  });

  it("groups by checkbox", () => {
    const groups = groupRows(rows, byId.get("flag")!);
    expect(groups.map((g) => [g.label, g.rows.map((r) => r.pageId)])).toEqual([
      ["Unchecked", ["2", "3", "4"]],
      ["Checked", ["1"]],
    ]);
  });
});
