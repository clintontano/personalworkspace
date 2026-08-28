import { expect, test } from "@playwright/test";
import { openApp } from "./helpers";

// Phase 5 happy path: a row change queues an event, the runner fires the
// matching rule, and its action lands as a notification.
test("marking a task done fires the automation", async ({ page }) => {
  await openApp(page);

  // set a task's Status to Done
  await page.locator("aside").getByText("Tasks", { exact: true }).click();
  const row = page.locator("tr", { has: page.locator('[data-row-title="Plan the week"]') });
  await row.getByRole("button").filter({ hasText: /To do|In progress|Done|—/ }).first().click();
  await page.getByRole("menuitem", { name: "Done" }).click();
  await expect(row.getByText("Done")).toBeVisible();

  // run the automations and confirm the rule fired
  await page.goto("/app/automations");
  await expect(page.getByTestId("automation-card").first()).toBeVisible();
  await page.getByTestId("run-automations").click();
  await expect(page.getByTestId("run-status")).toContainText(/rule\(s\) fired/, {
    timeout: 30_000,
  });
  await expect(page.getByTestId("run-status")).not.toContainText("0 rule(s) fired");

  // reset the task for the next run
  await page.goto("/app");
  await page.locator("aside").getByText("Tasks", { exact: true }).click();
  const resetRow = page.locator("tr", { has: page.locator('[data-row-title="Plan the week"]') });
  await resetRow.getByRole("button").filter({ hasText: "Done" }).first().click();
  await page.getByRole("menuitem", { name: "To do" }).click();
});
