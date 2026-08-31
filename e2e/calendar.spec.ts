import { expect, test } from "@playwright/test";
import { createFixtureDatabase, deleteFixturePage } from "./fixtures";
import { openApp } from "./helpers";

// Phase 3 happy path: a calendar view places rows on the grid by their date,
// month navigation works, and clicking one opens its row page. The database
// is a fixture so the spec does not depend on seeded rows still existing.
test("calendar view places rows on the grid", async ({ page }) => {
  // dates inside the current month, so the default view shows them
  const now = new Date();
  const day = (n: number) =>
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(n).padStart(2, "0")}`;

  const db = await createFixtureDatabase({
    label: "calendar",
    calendar: true,
    rows: [
      { title: "Fixture dentist", status: "todo", due: day(10) },
      { title: "Fixture birthday", status: "todo", due: day(20) },
    ],
  });

  try {
    await openApp(page);
    await page.goto(`/app/p/${db.databaseId}`);
    await page.getByRole("button", { name: "Calendar" }).click();

    await expect(page.getByTestId("calendar-view")).toBeVisible();
    await expect(page.getByText("Fixture dentist")).toBeVisible();
    await expect(page.getByText("Fixture birthday")).toBeVisible();

    // month navigation moves off them and back
    await page.getByLabel("Next month").click();
    await expect(page.getByText("Fixture dentist")).toHaveCount(0);
    await page.getByRole("button", { name: "Today" }).click();
    await expect(page.getByText("Fixture dentist")).toBeVisible();

    // clicking an event opens its row page
    await page.getByText("Fixture dentist").click();
    await expect(page.getByTestId("properties-panel")).toBeVisible();
    await expect(page.getByTestId("page-title")).toHaveValue("Fixture dentist");
  } finally {
    await deleteFixturePage(db.databaseId);
  }
});
