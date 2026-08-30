import { expect, test } from "@playwright/test";
import { createFixturePage, deleteFixturePage } from "./fixtures";
import { openApp } from "./helpers";

// Phase 1 happy path: create a page, write a block, survive a reload.
test("create a page, edit blocks, content persists after reload", async ({ page }) => {
  await openApp(page);

  await page.getByRole("button", { name: "New page" }).click();
  await expect(page).toHaveURL(/\/app\/p\//);

  const title = `E2E ${Date.now()}`;
  await page.getByTestId("page-title").fill(title);

  await page.locator(".bn-editor").click();
  await page.keyboard.type("Hello from Playwright");
  await expect(page.getByTestId("save-state")).toHaveText("Saved", {
    timeout: 15_000,
  });

  await page.reload();
  await expect(page.getByTestId("page-title")).toHaveValue(title);
  await expect(page.getByText("Hello from Playwright")).toBeVisible();

  // sidebar shows the renamed page
  const sidebarRow = page.locator(`[data-tree-page="${title}"]`);
  await expect(sidebarRow).toBeVisible();

  // clean up so repeated runs do not accumulate pages
  await sidebarRow.hover();
  await sidebarRow.getByLabel("Delete page").click();
  await expect(sidebarRow).toHaveCount(0, { timeout: 10_000 });
});

test("a page renders its stored blocks", async ({ page }) => {
  // its own page, so archiving or renaming workspace pages cannot break this
  const fixture = await createFixturePage({
    label: "blocks",
    blocks: [
      { text: "Welcome to your workspace", heading: true },
      { text: "Type / for the slash menu" },
    ],
  });
  try {
    await openApp(page);
    await page.goto(`/app/p/${fixture.pageId}`);
    await expect(page.getByText("Welcome to your workspace")).toBeVisible();
    await expect(page.getByText("Type / for the slash menu")).toBeVisible();
  } finally {
    await deleteFixturePage(fixture.pageId);
  }
});
