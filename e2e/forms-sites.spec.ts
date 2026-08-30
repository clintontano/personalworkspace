import { expect, test } from "@playwright/test";
import {
  createFixtureDatabase,
  createFixturePage,
  deleteFixturePage,
} from "./fixtures";
import { openApp } from "./helpers";

// Phase 4 happy path: publish a page tree and read it signed out; create a
// public form and submit a row into the database anonymously. Both arrange
// their own content rather than borrowing seeded pages.

test("publish a page and read it without a session", async ({ page, browser }) => {
  const fixture = await createFixturePage({
    label: "site",
    icon: "👋",
    blocks: [{ text: "Type / for the slash menu" }],
    child: {
      label: "nested",
      blocks: [{ text: "A nested page. The sidebar tree goes as deep as you like." }],
    },
  });

  try {
    await openApp(page);
    await page.goto(`/app/p/${fixture.pageId}`);
    await expect(page.getByTestId("page-title")).toHaveValue(fixture.title);

    await page.getByRole("button", { name: "Share" }).click();
    await expect(page.getByTestId("share-loading")).toHaveCount(0);
    const publishButton = page.getByTestId("publish-button");
    if (await publishButton.isVisible().catch(() => false)) {
      await publishButton.click();
    }
    const url = await page.getByTestId("site-url").inputValue();
    expect(url).toContain("/s/");

    // a clean context has no session at all
    const anon = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const publicPage = await anon.newPage();
    await publicPage.goto(url);
    await expect(
      publicPage.getByRole("heading", { name: new RegExp(fixture.title) }),
    ).toBeVisible();
    await expect(publicPage.getByText("Type / for the slash menu")).toBeVisible();

    // sub-pages are linked and readable
    await publicPage.getByRole("link", { name: new RegExp(fixture.child!.title) }).click();
    await expect(
      publicPage.getByText("A nested page. The sidebar tree goes as deep as you like."),
    ).toBeVisible();
    await anon.close();

    // leave the workspace as we found it
    await page.getByRole("button", { name: "Unpublish" }).click();
    await expect(page.getByTestId("publish-button")).toBeVisible();
  } finally {
    await deleteFixturePage(fixture.pageId);
  }
});

test("public form writes a row into the database", async ({ page, browser }) => {
  const db = await createFixtureDatabase({ label: "form-target" });

  try {
    await openApp(page);
    await page.goto(`/app/p/${db.databaseId}`);
    await expect(page.getByTestId("page-title")).toHaveValue(db.title);

    await page.getByRole("button", { name: "Forms" }).click();
    await expect(page.getByTestId("forms-loading")).toHaveCount(0);
    await page.getByTestId("create-form").click();
    const formUrl = await page.getByTestId("form-url").first().inputValue();
    expect(formUrl).toContain("/f/");

    const anon = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const publicPage = await anon.newPage();
    await publicPage.goto(formUrl);

    const title = `Form row ${Date.now()}`;
    await publicPage.getByLabel(/Title/).fill(title);
    await publicPage.getByRole("button", { name: "Submit" }).click();
    await expect(publicPage.getByText("Thanks!")).toBeVisible();
    await anon.close();

    // the row appears in the database
    await page.reload();
    await expect(page.locator(`[data-row-title="${title}"]`)).toBeVisible();
  } finally {
    // deleting the database page removes its rows and forms with it
    await deleteFixturePage(db.databaseId);
  }
});
