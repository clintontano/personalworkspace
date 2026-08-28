import fs from "node:fs";
import { expect, test as setup } from "@playwright/test";

export const AUTH_FILE = "playwright/.auth/user.json";

// Authenticate once for the whole run. A still-valid saved session is reused
// (the middleware refreshes tokens on visit), so repeated local runs perform
// zero password sign-ins and stay clear of auth rate limits.
setup("authenticate", async ({ page }) => {
  const email = process.env.SEED_USER_EMAIL;
  const password = process.env.SEED_USER_PASSWORD;
  if (!email || !password) {
    throw new Error("SEED_USER_EMAIL / SEED_USER_PASSWORD must be set to run e2e");
  }

  if (fs.existsSync(AUTH_FILE)) {
    const state = JSON.parse(fs.readFileSync(AUTH_FILE, "utf8"));
    if (Array.isArray(state.cookies) && state.cookies.length > 0) {
      await page.context().addCookies(state.cookies);
      await page.goto("/app");
      if (page.url().includes("/app")) {
        await page.context().storageState({ path: AUTH_FILE });
        return;
      }
      await page.context().clearCookies();
    }
  }

  // Fresh sign-in, with retries to ride out transient auth rate limiting.
  for (let attempt = 1; ; attempt++) {
    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: /sign in/i }).click();
    try {
      await expect(page).toHaveURL(/\/app/, { timeout: 30_000 });
      break;
    } catch (error) {
      if (attempt >= 3) throw error;
      await page.waitForTimeout(20_000);
    }
  }

  await page.context().storageState({ path: AUTH_FILE });
});
