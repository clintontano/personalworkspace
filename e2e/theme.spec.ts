import { expect, test } from "@playwright/test";
import { openApp } from "./helpers";

// Dark mode: the choice applies immediately, survives a reload (no flash of
// the wrong theme), and reaches the block editor.
test("theme choice applies and persists", async ({ page }) => {
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
  await page.locator("aside").getByText("Welcome", { exact: true }).click();
  await expect(page.locator(".bn-container")).toHaveClass(/dark/);

  await page.getByRole("radio", { name: "Light" }).click();
  await expect(html).not.toHaveClass(/dark/);
  await expect(page.locator(".bn-container")).not.toHaveClass(/dark/);

  // back to following the OS, so the suite leaves no sticky preference
  await page.getByRole("radio", { name: "System" }).click();
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
