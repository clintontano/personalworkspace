import { expect, type Page } from "@playwright/test";

export async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(process.env.SEED_USER_EMAIL!);
  await page.getByLabel("Password").fill(process.env.SEED_USER_PASSWORD!);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/app/);
}
