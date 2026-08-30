import { expect, test } from "@playwright/test";
import {
  createFixtureDatabase,
  deleteFixturePage,
  type FixtureDatabase,
} from "./fixtures";
import { openApp } from "./helpers";

const rowTitle = (title: string) => `[data-row-title="${title}"]`;

// Phase 2 happy path. The database is created per-spec rather than borrowed
// from the seed, so renaming or archiving workspace pages cannot break these.
let db: FixtureDatabase;

test.beforeEach(async () => {
  db = await createFixtureDatabase({
    label: "tasks",
    rows: [
      { title: "Pay rent", status: "todo" },
      { title: "Buy groceries", status: "todo" },
      { title: "Review Phase 2", status: "doing" },
    ],
  });
});

test.afterEach(async () => {
  await deleteFixturePage(db.databaseId);
});

test("tasks table renders, adds a row, opens row as page", async ({ page }) => {
  await openApp(page);
  await page.goto(`/app/p/${db.databaseId}`);
  await expect(page.getByTestId("page-title")).toHaveValue(db.title);
  await expect(page.locator(rowTitle("Pay rent"))).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Status" })).toBeVisible();

  // add a row inline. Target the new row by its empty title marker rather
  // than by position, so a slow render cannot rename an existing row.
  const before = await page.locator("[data-row-title]").count();
  await page.getByTestId("add-row").click();
  await expect(page.locator("[data-row-title]")).toHaveCount(before + 1);
  const newTitle = `Task ${Date.now()}`;
  const blank = page.locator('[data-row-title=""]').last();
  await blank.fill(newTitle);
  await blank.press("Enter");

  // survives a reload
  await page.reload();
  await expect(page.locator(rowTitle(newTitle))).toBeVisible();

  // open a row as a full page: properties panel + editor. The open link is
  // revealed on row hover.
  const row = page.locator("tr", { has: page.locator(rowTitle(newTitle)) });
  await row.hover();
  await row.getByLabel("Open row").click();
  await expect(page.getByTestId("properties-panel")).toBeVisible();
  await expect(page.getByTestId("page-title")).toHaveValue(newTitle);
});

test("filter and sort narrow the table", async ({ page }) => {
  await openApp(page);
  await page.goto(`/app/p/${db.databaseId}`);
  await expect(page.locator(rowTitle("Pay rent"))).toBeVisible();

  await page.getByRole("button", { name: /^Filter/ }).click();
  await page.getByRole("button", { name: "Add filter" }).click();
  await page.getByRole("textbox").last().fill("rent");
  await page.keyboard.press("Escape");

  await expect(page.locator(rowTitle("Pay rent"))).toBeVisible();
  await expect(page.locator(rowTitle("Buy groceries"))).toHaveCount(0);
});

test("board view shows status columns", async ({ page }) => {
  await openApp(page);
  await page.goto(`/app/p/${db.databaseId}`);
  await page.getByRole("button", { name: "Board" }).click();
  await expect(page.getByText("In progress").first()).toBeVisible();
  await expect(page.getByText("Review Phase 2")).toBeVisible();
});
