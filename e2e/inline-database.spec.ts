import { expect, test } from "@playwright/test";
import { deleteFixturePage } from "./fixtures";
import { openApp } from "./helpers";

// Inline databases: a database created from the slash menu lives inside the
// page, survives a reload, and is a real database (its own page, in the tree).
test("insert an inline database from the slash menu and reload", async ({ page }) => {
  await openApp(page);

  await page.getByRole("button", { name: "New page" }).click();
  await expect(page).toHaveURL(/\/app\/p\//);
  const pageUrl = page.url();
  const hostPageId = pageUrl.split("/app/p/")[1];

  const title = `E2E inline ${Date.now()}`;
  await page.getByTestId("page-title").fill(title);

  await page.locator(".bn-editor").click();
  await page.keyboard.type("/database");
  await page.getByText("A table, board, list or calendar inside this page").click();

  const inline = page.getByTestId("inline-database");
  await expect(inline).toBeVisible({ timeout: 20_000 });
  // it renders an actual view, not just a placeholder
  await expect(inline.getByTestId("add-row")).toBeVisible({ timeout: 20_000 });

  await expect(page.getByTestId("save-state")).toHaveText("Saved", { timeout: 20_000 });

  // name it, then confirm the embed survives a reload
  await inline.getByTestId("inline-database-title").fill("Embedded tasks");
  await page.waitForTimeout(1200);

  await page.goto(pageUrl);
  const reloaded = page.getByTestId("inline-database");
  await expect(reloaded).toBeVisible({ timeout: 20_000 });
  await expect(reloaded.getByTestId("inline-database-title")).toHaveValue(
    "Embedded tasks",
    { timeout: 20_000 },
  );

  // a row added inline is stored like any other database row
  await reloaded.getByTestId("add-row").click();
  await page.waitForTimeout(1000);
  await page.goto(pageUrl);
  // data rows only — the table's trailing "New row" affordance is also a <tr>
  await expect(
    page.getByTestId("inline-database").locator("[data-row-title]"),
  ).toHaveCount(1, { timeout: 20_000 });

  // the host page and the database nested inside it
  await deleteFixturePage(hostPageId);
});
