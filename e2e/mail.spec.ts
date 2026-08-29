import { expect, test } from "@playwright/test";
import { openApp } from "./helpers";

// Phase 7 happy path. Gmail may or may not be connected on a given machine,
// so each test asserts the correct behaviour for the state it finds rather
// than assuming one of them.

test("mail screen reflects its connection state", async ({ page }) => {
  await openApp(page);
  await page.getByRole("link", { name: "Mail", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/mail/);

  const connectLink = page.getByRole("link", { name: "Connect Gmail" });
  const setupHint = page.getByText("GOOGLE_CLIENT_ID");
  const refresh = page.getByRole("button", { name: "Refresh inbox" });

  if (await refresh.isVisible().catch(() => false)) {
    // connected: the inbox pane renders and a thread can be opened
    await expect(page.getByText("Select a thread to read it.")).toBeVisible();
  } else if (await connectLink.isVisible().catch(() => false)) {
    // credentials configured, account not yet connected
    await expect(connectLink).toBeVisible();
  } else {
    // no OAuth credentials at all: the page explains the setup
    await expect(setupHint).toBeVisible();
  }
});

test("thread-to-row endpoint validates its input", async ({ page }) => {
  await openApp(page);
  const response = await page.request.post("/api/gmail/task", { data: {} });
  // 400 when connected (missing ids), 404 when there is no connection —
  // either way it refuses cleanly rather than throwing
  expect([400, 404]).toContain(response.status());
  expect(await response.json()).toHaveProperty("error");
});

test("settings lists both Google connections", async ({ page }) => {
  await openApp(page);
  await page.goto("/app/settings");
  await expect(page.getByRole("heading", { name: "Google Calendar" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Gmail" })).toBeVisible();
});
