import { expect, test } from "@playwright/test";
import { openApp } from "./helpers";

const rowTitle = (title: string) => `[data-row-title="${title}"]`;

// Phase 2 happy path: table renders seeded rows, add a row, open it as a page.
test("tasks table renders, adds a row, opens row as page", async ({ page }) => {
  await openApp(page);

  await page.locator("aside").getByText("Tasks", { exact: true }).click();
  await expect(page.getByTestId("page-title")).toHaveValue("Tasks");
  await expect(page.locator(rowTitle("Pay rent"))).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Status" })).toBeVisible();

  // add a row inline. Target the new row by its empty title marker rather
  // than by position, so a slow render cannot rename a seeded row.
  const before = await page.locator("[data-row-title]").count();
  await page.getByTestId("add-row").click();
  await expect(page.locator("[data-row-title]")).toHaveCount(before + 1);
  const newTitle = `Task ${Date.now()}`;
  const blank = page.locator('[data-row-title=""]');
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

  // clean up so repeated runs do not accumulate rows
  await page.goBack();
  const created = page.locator("tr", { has: page.locator(rowTitle(newTitle)) });
  await created.hover();
  await created.getByLabel("Delete row").click();
  await expect(page.locator(rowTitle(newTitle))).toHaveCount(0);
});

test("filter and sort narrow the table", async ({ page }) => {
  await openApp(page);
  await page.locator("aside").getByText("Tasks", { exact: true }).click();
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
  await page.locator("aside").getByText("Tasks", { exact: true }).click();
  await page.getByRole("button", { name: "Board" }).click();
  await expect(page.getByText("In progress").first()).toBeVisible();
  await expect(page.getByText("Review Phase 2")).toBeVisible();
});
