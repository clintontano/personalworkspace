import { expect, test } from "@playwright/test";
import { deleteFixturePage, readPageMeta } from "./fixtures";
import { openApp } from "./helpers";

/**
 * Inline pages: /page in the slash menu creates a real child page and links
 * it from the body. Because the target is an ordinary page row it also shows
 * up in the sidebar tree and opens on its own.
 */
test("insert a sub-page from the slash menu and follow it", async ({ page }) => {
  await openApp(page);
  await page.getByRole("button", { name: "New page" }).click();
  await expect(page).toHaveURL(/\/app\/p\//);
  const hostUrl = page.url();
  const hostId = hostUrl.split("/app/p/")[1];

  const hostTitle = `E2E~inline-host ${Date.now()}`;
  await page.getByTestId("page-title").fill(hostTitle);

  try {
    await page.locator(".bn-editor").click();
    await page.keyboard.type("/page");
    await expect(page.getByText("A sub-page nested inside this one")).toBeVisible();
    await page.keyboard.press("Enter");

    // the link renders in the body
    const link = page.getByTestId("inline-page");
    await expect(link).toBeVisible({ timeout: 20_000 });
    const childId = await link.getAttribute("data-page-id");
    expect(childId).toBeTruthy();

    // it is a real page, parented to the host
    await expect
      .poll(async () => (await readPageMeta(childId!)).parent_page_id, { timeout: 15_000 })
      .toBe(hostId);

    // survives a reload, served from the server-side title fetch
    await page.reload();
    await expect(page.getByTestId("inline-page")).toBeVisible({ timeout: 20_000 });

    // clicking it opens that page
    await page.getByTestId("inline-page").click();
    await expect(page).toHaveURL(new RegExp(childId!));
  } finally {
    await deleteFixturePage(hostId);
  }
});

test("the app is usable at a phone width", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openApp(page);

  // the sidebar starts off-canvas and the page does not scroll sideways
  const sidebar = page.getByTestId("sidebar");
  await expect(sidebar).toHaveAttribute("data-open", "false");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBe(true);

  // the menu opens the drawer, and Escape closes it
  await page.getByLabel("Open menu").click();
  await expect(sidebar).toHaveAttribute("data-open", "true");
  await expect
    .poll(async () => (await sidebar.boundingBox())!.x)
    .toBeGreaterThanOrEqual(0);

  await page.keyboard.press("Escape");
  await expect(sidebar).toHaveAttribute("data-open", "false");
});

test("the sidebar is a permanent column on a desktop width", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openApp(page);

  // the menu button is hidden by md:hidden — still in the DOM, so assert on
  // visibility rather than count
  await expect(page.getByLabel("Open menu")).toBeHidden();
  expect((await page.getByTestId("sidebar").boundingBox())!.x).toBe(0);
});
