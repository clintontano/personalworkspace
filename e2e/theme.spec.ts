import { expect, test } from "@playwright/test";
import { createFixturePage, deleteFixturePage } from "./fixtures";
import { openApp } from "./helpers";

// Dark mode: the choice applies immediately, survives a reload (no flash of
// the wrong theme), and reaches the block editor.
test("theme choice applies and persists", async ({ page }) => {
  const fixture = await createFixturePage({
    label: "theme",
    blocks: [{ text: "Theme fixture body" }],
  });
  await openApp(page);

  const html = page.locator("html");
  await page.getByRole("radio", { name: "Dark" }).click();
  await expect(html).toHaveClass(/dark/);

  await page.reload();
  await expect(html).toHaveClass(/dark/);
  await expect(page.getByRole("radio", { name: "Dark" })).toHaveAttribute(
    "aria-checked",
    "true",
  );

  // the editor follows the app theme rather than staying light
  await page.goto(`/app/p/${fixture.pageId}`);
  await expect(page.locator(".bn-container")).toHaveClass(/dark/);

  await page.getByRole("radio", { name: "Light" }).click();
  await expect(html).not.toHaveClass(/dark/);
  await expect(page.locator(".bn-container")).not.toHaveClass(/dark/);

  // back to following the OS, so the suite leaves no sticky preference
  await page.getByRole("radio", { name: "System" }).click();

  await deleteFixturePage(fixture.pageId);
});

test("published pages render in the visitor's theme", async ({ browser }) => {
  const context = await browser.newContext({
    storageState: { cookies: [], origins: [] },
    colorScheme: "dark",
  });
  const page = await context.newPage();
  await page.goto("/login");
  await expect(page.locator("html")).toHaveClass(/dark/);
  await context.close();
});
