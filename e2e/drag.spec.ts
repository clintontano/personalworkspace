import { expect, test, type Page } from "@playwright/test";
import {
  createFixtureDatabase,
  createFixturePage,
  deleteFixturePage,
  readPageMeta,
  readPropertyOrder,
  readViewConfig,
} from "./fixtures";
import { openApp } from "./helpers";

/** Width of a column, read from the <col> that actually sizes it. */
async function columnWidth(page: Page, index: number): Promise<number> {
  return page.evaluate(
    (i) => document.querySelectorAll("colgroup col")[i].getBoundingClientRect().width,
    index,
  );
}

test("a column can be dragged wider and the width persists", async ({ page }) => {
  const db = await createFixtureDatabase({
    label: "resize",
    rows: [{ title: "Alpha", status: "todo" }],
  });

  try {
    await openApp(page);
    await page.goto(`/app/p/${db.databaseId}`);
    await expect(page.locator('[data-row-title="Alpha"]')).toBeVisible();

    const before = await columnWidth(page, 0);
    const handle = page.getByRole("separator", { name: "Resize Title column" });
    const box = (await handle.boundingBox())!;

    // drag the grip 120px to the right
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2, {
      steps: 12,
    });
    await page.mouse.up();

    const after = await columnWidth(page, 0);
    expect(after).toBeGreaterThan(before + 80);

    // debounced save, then confirm it is stored on the view
    await expect
      .poll(async () => (await readViewConfig(db.databaseId)).columnWidths?.title ?? 0, {
        timeout: 15_000,
      })
      .toBeGreaterThan(before + 80);

    // and survives a reload
    await page.reload();
    await expect(page.locator('[data-row-title="Alpha"]')).toBeVisible();
    expect(await columnWidth(page, 0)).toBeGreaterThan(before + 80);
  } finally {
    await deleteFixturePage(db.databaseId);
  }
});

test("a column cannot be dragged below its minimum width", async ({ page }) => {
  const db = await createFixtureDatabase({ label: "resize-min" });

  try {
    await openApp(page);
    await page.goto(`/app/p/${db.databaseId}`);
    const handle = page.getByRole("separator", { name: "Resize Title column" });
    const box = (await handle.boundingBox())!;

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x - 500, box.y + box.height / 2, { steps: 10 });
    await page.mouse.up();

    // clamped, not collapsed or negative
    expect(await columnWidth(page, 0)).toBeGreaterThanOrEqual(70);
  } finally {
    await deleteFixturePage(db.databaseId);
  }
});

test("columns can be dragged into a new order", async ({ page }) => {
  const db = await createFixtureDatabase({
    label: "reorder",
    rows: [{ title: "Alpha", status: "todo" }],
  });

  try {
    await openApp(page);
    await page.goto(`/app/p/${db.databaseId}`);
    await expect(page.locator('[data-row-title="Alpha"]')).toBeVisible();

    // fixtures create Status then Due
    expect(await readPropertyOrder(db.databaseId)).toEqual(["Status", "Due"]);

    await page
      .locator(`th[data-column-id="${db.statusPropertyId}"]`)
      .dragTo(page.locator(`th[data-column-id="${db.duePropertyId}"]`), {
        targetPosition: { x: 120, y: 10 }, // right half → drop after
      });

    // header order flips in the DOM
    await expect
      .poll(async () =>
        page.locator("thead th[data-column-id]").evaluateAll((els) =>
          els.map((e) => e.textContent?.trim()),
        ),
      )
      .toEqual(["Title", "Due", "Status"]);

    // and is persisted on the properties themselves
    await expect
      .poll(async () => readPropertyOrder(db.databaseId), { timeout: 15_000 })
      .toEqual(["Due", "Status"]);
  } finally {
    await deleteFixturePage(db.databaseId);
  }
});

test("sidebar pages can be dragged into a new order", async ({ page }) => {
  const first = await createFixturePage({ label: "drag-a" });
  const second = await createFixturePage({ label: "drag-b" });

  try {
    await openApp(page);

    const firstRow = page.locator(`[data-tree-page="${first.title}"]`);
    const secondRow = page.locator(`[data-tree-page="${second.title}"]`);
    await expect(firstRow).toBeVisible();
    await expect(secondRow).toBeVisible();

    const before = await readPageMeta(first.pageId);
    const secondBefore = await readPageMeta(second.pageId);
    expect(before.order_key < secondBefore.order_key).toBe(true);

    // drop into the bottom band of the target ("after"), measured rather
    // than guessed: the band boundaries are fractions of the row height
    const box = (await secondRow.boundingBox())!;
    await firstRow.dragTo(secondRow, {
      targetPosition: { x: Math.min(60, box.width / 2), y: box.height - 2 },
    });

    await expect
      .poll(
        async () => {
          const a = await readPageMeta(first.pageId);
          const b = await readPageMeta(second.pageId);
          return a.order_key > b.order_key;
        },
        { timeout: 15_000 },
      )
      .toBe(true);

    // still siblings at the root, not nested
    expect((await readPageMeta(first.pageId)).parent_page_id).toBeNull();
  } finally {
    await deleteFixturePage(first.pageId);
    await deleteFixturePage(second.pageId);
  }
});

test("dragging a page onto another nests it", async ({ page }) => {
  const parent = await createFixturePage({ label: "nest-parent" });
  const child = await createFixturePage({ label: "nest-child" });

  try {
    await openApp(page);
    const parentRow = page.locator(`[data-tree-page="${parent.title}"]`);
    const childRow = page.locator(`[data-tree-page="${child.title}"]`);
    await expect(parentRow).toBeVisible();

    // middle band → nest inside
    const box = (await parentRow.boundingBox())!;
    await childRow.dragTo(parentRow, {
      targetPosition: { x: Math.min(60, box.width / 2), y: box.height / 2 },
    });

    await expect
      .poll(async () => (await readPageMeta(child.pageId)).parent_page_id, {
        timeout: 15_000,
      })
      .toBe(parent.pageId);
  } finally {
    await deleteFixturePage(child.pageId);
    await deleteFixturePage(parent.pageId);
  }
});
