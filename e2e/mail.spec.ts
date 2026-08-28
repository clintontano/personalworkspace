import { expect, test } from "@playwright/test";
import { openApp } from "./helpers";

// Phase 7 happy path. Google OAuth credentials are optional, so the mail
// screen must degrade honestly: it explains the setup rather than erroring,
// and the thread->row endpoint refuses cleanly when not connected.
test("mail screen explains setup when Gmail is not connected", async ({ page }) => {
  await openApp(page);
  await page.getByRole("link", { name: "Mail", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/mail/);

  const configured = await page.getByText("Connect Gmail").isVisible().catch(() => false);
  if (configured) {
    // OAuth configured but not connected: the connect action is offered.
    await expect(page.getByRole("link", { name: "Connect Gmail" })).toBeVisible();
  } else {
    // No OAuth credentials: the page states what to add, without crashing.
    await expect(page.getByText("GOOGLE_CLIENT_ID")).toBeVisible();
  }
});

test("thread-to-row endpoint refuses when Gmail is not connected", async ({ page }) => {
  await openApp(page);
  const response = await page.request.post("/api/gmail/task", {
    data: { threadId: "abc", databaseId: "def" },
  });
  expect(response.status()).toBe(404);
  expect((await response.json()).error).toContain("gmail not connected");
});

test("settings lists both Google connections", async ({ page }) => {
  await openApp(page);
  await page.goto("/app/settings");
  await expect(page.getByRole("heading", { name: "Google Calendar" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Gmail" })).toBeVisible();
});
