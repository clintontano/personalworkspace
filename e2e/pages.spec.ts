import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

// Phase 1 happy path: create a page, write a block, survive a reload.
test("create a page, edit blocks, content persists after reload", async ({ page }) => {
  test.skip(!process.env.SEED_USER_EMAIL, "seed credentials not set");
  await signIn(page);

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
  await expect(
    page.locator("aside").getByText(title, { exact: true }),
  ).toBeVisible();
});

test("seeded Welcome page renders its blocks", async ({ page }) => {
  test.skip(!process.env.SEED_USER_EMAIL, "seed credentials not set");
  await signIn(page);
  await page.locator("aside").getByText("Welcome", { exact: true }).click();
  await expect(page.getByText("Welcome to your workspace")).toBeVisible();
  await expect(page.getByText("Type / for the slash menu")).toBeVisible();
});
