import { describe, expect, it } from "vitest";
import type { Property, Row } from "@/lib/db/model";
import {
  isNoopUpdate,
  matchesTrigger,
  planActions,
  renderTemplate,
  type Automation,
} from "./rules";

const status: Property = {
  id: "status",
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
const done: Property = { id: "done", name: "Done", type: "checkbox", config: {}, order_key: "a1" };
const tags: Property = {
  id: "tags",
  name: "Tags",
  type: "multi_select",
  order_key: "a2",
  config: { options: [{ id: "work", name: "Work", color: "blue" }] },
};
const props = new Map([status, done, tags].map((p) => [p.id, p]));

const row = (overrides: Partial<Row> = {}): Row => ({
  pageId: "page-1",
  title: "Ship it",
  icon: null,
  properties: { status: "todo", done: false, tags: ["work"] },
  orderKey: "a0",
  createdAt: "2026-08-01",
  updatedAt: "2026-08-01",
  ...overrides,
});

const automation = (overrides: Partial<Automation> = {}): Automation => ({
  id: "auto-1",
  name: "Test",
  enabled: true,
  trigger: { type: "row_updated", databaseId: "db-1" },
  actions: [],
  ...overrides,
});

describe("matchesTrigger", () => {
  it("matches kind and database", () => {
    expect(matchesTrigger(automation(), { kind: "row_updated", databaseId: "db-1" })).toBe(true);
  });

  it("rejects a different database", () => {
    expect(matchesTrigger(automation(), { kind: "row_updated", databaseId: "db-2" })).toBe(false);
  });

  it("rejects a different event kind", () => {
    expect(matchesTrigger(automation(), { kind: "row_created", databaseId: "db-1" })).toBe(false);
  });

  it("never fires when disabled", () => {
    expect(
      matchesTrigger(automation({ enabled: false }), { kind: "row_updated", databaseId: "db-1" }),
    ).toBe(false);
  });
});

describe("renderTemplate", () => {
  it("substitutes title and properties by name", () => {
    expect(renderTemplate("{{title}} is {{prop:status}}", row(), props)).toBe("Ship it is To do");
  });

  it("renders checkboxes and multi-selects readably", () => {
    expect(renderTemplate("{{prop:done}} / {{prop:tags}}", row(), props)).toBe("No / Work");
  });

  it("blanks unknown references instead of leaking the token", () => {
    expect(renderTemplate("[{{prop:nope}}][{{bogus}}]", row(), props)).toBe("[][]");
  });

  it("tolerates whitespace inside the braces", () => {
    expect(renderTemplate("{{ title }}", row(), props)).toBe("Ship it");
  });
});

describe("planActions", () => {
  it("merges set_property actions into one update", () => {
    const ops = planActions(
      automation({
        actions: [
          { type: "set_property", propertyId: "status", value: "done" },
          { type: "set_property", propertyId: "done", value: true },
        ],
      }),
      row(),
      props,
    );
    expect(ops).toEqual([
      { kind: "update_row", pageId: "page-1", properties: { status: "done", done: true } },
    ]);
  });

  it("skips rows that fail the trigger filter", () => {
    const ops = planActions(
      automation({
        trigger: {
          type: "row_updated",
          databaseId: "db-1",
          filter: { combinator: "and", conditions: [{ property: "status", op: "eq", value: "done" }] },
        },
        actions: [{ type: "notify", message: "done!" }],
      }),
      row(),
      props,
    );
    expect(ops).toEqual([]);
  });

  it("fires when the filter passes", () => {
    const ops = planActions(
      automation({
        trigger: {
          type: "row_updated",
          databaseId: "db-1",
          filter: { combinator: "and", conditions: [{ property: "status", op: "eq", value: "todo" }] },
        },
        actions: [{ type: "notify", message: "{{title}} needs work" }],
      }),
      row(),
      props,
    );
    expect(ops).toEqual([
      { kind: "notify", message: "Ship it needs work", pageId: "page-1" },
    ]);
  });

  it("creates rows with rendered titles", () => {
    const ops = planActions(
      automation({
        actions: [
          { type: "create_row", databaseId: "db-2", title: "Follow up: {{title}}", properties: { status: "todo" } },
        ],
      }),
      row(),
      props,
    );
    expect(ops).toEqual([
      { kind: "insert_row", databaseId: "db-2", title: "Follow up: Ship it", properties: { status: "todo" } },
    ]);
  });

  it("puts the row update before other operations", () => {
    const ops = planActions(
      automation({
        actions: [
          { type: "notify", message: "hi" },
          { type: "set_property", propertyId: "done", value: true },
        ],
      }),
      row(),
      props,
    );
    expect(ops.map((o) => o.kind)).toEqual(["update_row", "notify"]);
  });

  it("ignores set_property when there is no row (schedule without database)", () => {
    const ops = planActions(
      automation({
        trigger: { type: "schedule", cron: "0 9 * * *" },
        actions: [
          { type: "set_property", propertyId: "done", value: true },
          { type: "notify", message: "daily" },
        ],
      }),
      null,
      props,
    );
    expect(ops).toEqual([{ kind: "notify", message: "daily", pageId: null }]);
  });
});

describe("isNoopUpdate", () => {
  it("detects an update that would change nothing", () => {
    const op = { kind: "update_row" as const, pageId: "page-1", properties: { status: "todo" } };
    expect(isNoopUpdate(op, row())).toBe(true);
  });

  it("detects a real change", () => {
    const op = { kind: "update_row" as const, pageId: "page-1", properties: { status: "done" } };
    expect(isNoopUpdate(op, row())).toBe(false);
  });

  it("compares array values by content", () => {
    const op = { kind: "update_row" as const, pageId: "page-1", properties: { tags: ["work"] } };
    expect(isNoopUpdate(op, row())).toBe(true);
  });
});
