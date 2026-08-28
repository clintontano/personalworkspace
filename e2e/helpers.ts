import { expect, type Page } from "@playwright/test";

/** Land in the app shell using the session saved by auth.setup.ts. */
export async function openApp(page: Page) {
  await page.goto("/app");
  await expect(page.getByTestId("workspace-name")).toBeVisible();
}
