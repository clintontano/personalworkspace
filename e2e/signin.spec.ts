import { expect, test } from "@playwright/test";

// Happy path for Phase 0: sign in with the seeded user and land in the
// workspace shell with the RLS-fetched workspace visible.
test("sign in and see the workspace shell", async ({ page }) => {
  const email = process.env.SEED_USER_EMAIL;
  const password = process.env.SEED_USER_PASSWORD;
  test.skip(!email || !password, "SEED_USER_EMAIL/PASSWORD not set");

  await page.goto("/login");
  await page.getByLabel("Email").fill(email!);
  await page.getByLabel("Password").fill(password!);
  await page.getByRole("button", { name: /sign in/i }).click();

  await expect(page).toHaveURL(/\/app/);
  await expect(page.getByTestId("workspace-name")).toBeVisible();
  await expect(page.getByText("Phase 0: Foundation")).toBeVisible();
});

test("unauthenticated visit to /app redirects to login", async ({ page }) => {
  await page.goto("/app");
  await expect(page).toHaveURL(/\/login/);
});
