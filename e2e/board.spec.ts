import { expect, test } from "@playwright/test";
import {
  addFixtureTextProperty,
  createFixtureDatabase,
  deleteFixturePage,
  readNamedViewConfig,
  type FixtureDatabase,
} from "./fixtures";
import { openApp } from "./helpers";

/**
 * Board cards show what the view's visibility menu says, formatted the way the
 * rest of the app formats it. They used to show only the first two selects or
 * dates, raw, whatever the menu said, so a Notion-style "By week" board could
 * not show both a start and an end date.
 */
let db: FixtureDatabase;

test.beforeEach(async () => {
  db = await createFixtureDatabase({
    label: "board",
    rows: [{ title: "Ship the week view", status: "doing", due: "2026-09-15" }],
  });
  await addFixtureTextProperty(db, "Owner", "Ship the week view", "Clinton");
});

test.afterEach(async () => {
  await deleteFixturePage(db.databaseId);
});

test("board cards follow the visibility menu and can be renamed", async ({ page }) => {
  await openApp(page);
  await page.goto(`/app/p/${db.databaseId}`);
  await page.getByRole("button", { name: "Board" }).click();

  const card = page.locator("[draggable=true]", { hasText: "Ship the week view" });
  await expect(card).toBeVisible();
  // formatted like every other date in the app, not "2026-09-15"
  await expect(card.getByText("Sep 15 2026")).toBeVisible();
  // a text property: the old cards showed only selects and dates
  await expect(card.getByText("Clinton")).toBeVisible();

  // a long-running select (Week) leaves many empty columns; they can be hidden
  await expect(page.getByText("To do", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /^Group/ }).click();
  await page.getByRole("menuitemcheckbox", { name: "Hide empty groups" }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByText("To do", { exact: true })).toHaveCount(0);
  await expect(page.getByText("In progress", { exact: true })).toBeVisible();

  // hiding a property in this view takes it off the cards
  await page.locator("button:has(svg.lucide-eye)").click();
  await page.getByRole("menuitemcheckbox", { name: "Due" }).click();
  await page.keyboard.press("Escape");
  await expect(card.getByText("Sep 15 2026")).toHaveCount(0);

  // views get real names, as Notion's "By week" / "By status" tabs have
  await page.getByRole("button", { name: "Board" }).dblclick();
  const name = page.getByLabel("View name");
  await name.fill("By status");
  await name.press("Enter");
  await expect(page.getByRole("button", { name: "By status" })).toBeVisible();

  await expect
    .poll(async () => await readNamedViewConfig(db.databaseId, "By status"))
    .toMatchObject({ hidden: [db.duePropertyId], hideEmptyGroups: true });
  await page.reload();
  await expect(page.getByRole("button", { name: "By status" })).toBeVisible();
});
