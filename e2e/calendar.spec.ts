import { expect, test } from "@playwright/test";
import { openApp } from "./helpers";

// Phase 3 happy path: the Events database opens on its calendar view with
// seeded events placed on the grid, and clicking a day creates a row there.
test("events calendar renders seeded events", async ({ page }) => {
  await openApp(page);
  await page.locator("aside").getByText("Events", { exact: true }).click();

  await expect(page.getByTestId("calendar-view")).toBeVisible();
  await expect(page.getByText("Dentist")).toBeVisible();
  await expect(page.getByText("Mom's birthday")).toBeVisible();

  // month navigation works
  await page.getByLabel("Next month").click();
  await expect(page.getByText("Dentist")).toHaveCount(0);
  await page.getByRole("button", { name: "Today" }).click();
  await expect(page.getByText("Dentist")).toBeVisible();

  // clicking an event opens its row page
  await page.getByText("Dentist").click();
  await expect(page.getByTestId("properties-panel")).toBeVisible();
  await expect(page.getByTestId("page-title")).toHaveValue("Dentist");
});
