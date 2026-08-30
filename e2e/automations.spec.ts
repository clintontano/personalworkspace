import { expect, test } from "@playwright/test";
import {
  createFixtureAutomation,
  createFixtureDatabase,
  deleteFixtureAutomation,
  deleteFixturePage,
} from "./fixtures";
import { openApp } from "./helpers";

// Phase 5 happy path: a row change queues an event, the runner fires the
// matching rule, and its action lands as a notification. The database and the
// rule are both fixtures, so the spec does not depend on the seeded rule
// still pointing at a database that exists.
// "Run now" drains the whole workspace queue, which can be large on a
// long-lived workspace with no deployed scheduler, so this needs headroom.
test.setTimeout(150_000);

test("marking a task done fires the automation", async ({ page }) => {
  const db = await createFixtureDatabase({
    label: "automation",
    rows: [{ title: "Plan the week", status: "todo" }],
  });
  const rule = await createFixtureAutomation({
    label: "rule",
    databaseId: db.databaseId,
    statusPropertyId: db.statusPropertyId,
  });

  try {
    await openApp(page);
    await page.goto(`/app/p/${db.databaseId}`);

    // set the task's Status to Done
    const row = page.locator("tr", {
      has: page.locator('[data-row-title="Plan the week"]'),
    });
    await row
      .getByRole("button")
      .filter({ hasText: /To do|In progress|Done|—/ })
      .first()
      .click();
    await page.getByRole("menuitem", { name: "Done" }).click();
    await expect(row.getByText("Done")).toBeVisible();

    // run the automations and confirm a rule fired
    await page.goto("/app/automations");
    await expect(page.getByTestId("automation-card").first()).toBeVisible();
    await page.getByTestId("run-automations").click();
    // at least one rule fired (anchored so "10 rule(s)" is not read as "0 rule(s)")
    await expect(page.getByTestId("run-status")).toContainText(
      /(?:^|\s)[1-9]\d* rule\(s\) fired/,
      { timeout: 120_000 },
    );
  } finally {
    await deleteFixtureAutomation(rule.automationId);
    await deleteFixturePage(db.databaseId);
  }
});
