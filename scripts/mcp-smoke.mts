/**
 * MCP smoke test: drives the real stdio server as a client and exercises
 * every tool, then removes what it created.
 *
 * This is Phase 6's happy path — the deliverable is a server, not a screen,
 * so it is verified here rather than in Playwright.
 *
 * Usage: npm run mcp:check
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { createFixtureDatabase, deleteFixturePage } from "../e2e/fixtures";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
config({ path: path.join(repoRoot, ".env.local"), quiet: true });

const checks: { name: string; ok: boolean; detail: string }[] = [];
function check(name: string, ok: boolean, detail = "") {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}

const transport = new StdioClientTransport({
  command: "npx",
  args: ["tsx", path.join(repoRoot, "mcp", "server.mts")],
  cwd: repoRoot,
});
const client = new Client({ name: "mcp-smoke", version: "1.0.0" });
await client.connect(transport);

type ToolResult = { isError?: boolean; content?: { text?: string }[] };
async function call(name: string, args: Record<string, unknown> = {}) {
  const result = (await client.callTool({ name, arguments: args })) as ToolResult;
  const text = result.content?.[0]?.text ?? "";
  if (result.isError) throw new Error(`${name}: ${text}`);
  return text ? JSON.parse(text) : null;
}

const createdPageIds: string[] = [];

// Its own database, rather than assuming a seeded one still exists under a
// particular name — renaming a workspace page used to break this check.
const fixture = await createFixtureDatabase({
  label: "mcp-smoke",
  rows: [{ title: "Smoke todo", status: "todo" }],
});

try {
  const { tools } = await client.listTools();
  const expected = [
    "search", "read_page", "create_page", "append_blocks",
    "list_databases", "query_database", "create_row", "update_row_properties",
    "delete_page", "restore_page", "list_trash", "clear_cells",
    "delete_property", "delete_blocks",
  ];
  const names = tools.map((t) => t.name);
  check("all tools exposed", expected.every((t) => names.includes(t)), names.join(", "));

  const databases = await call("list_databases");
  const tasks = databases.find(
    (d: { databaseId: string }) => d.databaseId === fixture.databaseId,
  );
  check("list_databases finds the fixture database", Boolean(tasks));

  const todo = await call("query_database", {
    database_id: fixture.databaseId,
    filter: { combinator: "and", conditions: [{ property: "Status", op: "eq", value: "To do" }] },
  });
  check(
    "query_database filters by property name",
    Array.isArray(todo) && todo.length > 0,
    `${todo.length} row(s)`,
  );

  const row = await call("create_row", {
    database_id: fixture.databaseId,
    title: "MCP smoke row",
    properties: { Status: "In progress", Due: "2026-09-15" },
    markdown: "## Notes\n\nCreated by **MCP**.\n\n- [ ] round trip",
  });
  createdPageIds.push(row.pageId);

  const read = await call("read_page", { page_id: row.pageId });
  check(
    "create_row coerces property names to stored values",
    read.properties.Status === "In progress" && read.properties.Due === "2026-09-15",
    JSON.stringify(read.properties),
  );
  check(
    "markdown survives the write/read round trip",
    read.markdown.includes("## Notes") && read.markdown.includes("**MCP**") && read.markdown.includes("- [ ] round trip"),
  );

  await call("update_row_properties", {
    page_id: row.pageId,
    properties: { Status: "Done" },
    title: "MCP smoke row (updated)",
  });
  const updated = await call("read_page", { page_id: row.pageId });
  check(
    "update_row_properties applies title and value",
    updated.title === "MCP smoke row (updated)" && updated.properties.Status === "Done",
  );

  const page = await call("create_page", {
    title: "MCP smoke page",
    icon: "🤖",
    markdown: "# Hi\n\n- one\n  - nested",
  });
  createdPageIds.push(page.pageId);
  await call("append_blocks", { page_id: page.pageId, markdown: "> appended quote" });
  const pageRead = await call("read_page", { page_id: page.pageId });
  check(
    "append_blocks adds to the end and preserves nesting",
    pageRead.markdown.includes("- one\n  - nested") && pageRead.markdown.trimEnd().endsWith("> appended quote"),
    JSON.stringify(pageRead.markdown),
  );

  const found = await call("search", { query: "MCP smoke page" });
  check("search finds a freshly created page", found.some((f: { pageId: string }) => f.pageId === page.pageId));

  // Destructive tools --------------------------------------------------------

  await call("clear_cells", { page_id: row.pageId, properties: ["Due"] });
  const cleared = await call("read_page", { page_id: row.pageId });
  check(
    "clear_cells empties the named property and leaves the others",
    cleared.properties.Due === undefined && cleared.properties.Status === "Done",
    JSON.stringify(cleared.properties),
  );

  const clearAgain = await call("clear_cells", { page_id: row.pageId, properties: ["Due"] });
  check(
    "clearing an already-empty cell is a no-op, not a write",
    clearAgain.cleared.length === 0 && clearAgain.alreadyEmpty.includes("Due"),
  );

  const withIds = await call("read_page", { page_id: page.pageId, include_block_ids: true });
  check(
    "read_page lists block ids when asked",
    Array.isArray(withIds.blocks) && withIds.blocks.length > 0,
    `${withIds.blocks?.length} block(s)`,
  );
  const firstBlockId = withIds.blocks[0].blockId;
  const blocksRemoved = await call("delete_blocks", {
    page_id: page.pageId,
    block_ids: [firstBlockId],
  });
  const afterBlocks = await call("read_page", { page_id: page.pageId, include_block_ids: true });
  check(
    "delete_blocks removes the named block and keeps the page",
    blocksRemoved.removed >= 1 &&
      !afterBlocks.blocks.some((b: { blockId: string }) => b.blockId === firstBlockId),
  );

  // A sub-page, to show archiving moves the whole subtree.
  const child = await call("create_page", {
    title: "MCP smoke child",
    parent_page_id: page.pageId,
  });
  createdPageIds.push(child.pageId);

  const archived = await call("delete_page", { page_id: page.pageId });
  check(
    "delete_page archives the page together with its sub-pages",
    archived.mode === "archived" && archived.pageCount === 2,
    JSON.stringify(archived.pages),
  );

  const searchedAfterArchive = await call("search", { query: "MCP smoke page" });
  check(
    "an archived page drops out of search",
    !searchedAfterArchive.some((f: { pageId: string }) => f.pageId === page.pageId),
  );

  const trash = await call("list_trash");
  const trashedRoot = trash.find((t: { pageId: string }) => t.pageId === page.pageId);
  check("list_trash finds it, marked as the page to restore", trashedRoot?.isRoot === true);
  check(
    "the sub-page is in the trash but is not the restore target",
    trash.some(
      (t: { pageId: string; isRoot: boolean }) => t.pageId === child.pageId && t.isRoot === false,
    ),
  );

  const restored = await call("restore_page", { page_id: page.pageId });
  check(
    "restore_page brings back the page and what was archived with it",
    restored.restoredCount === 2 && restored.hiddenUnder === null,
    JSON.stringify(restored),
  );
  const readAfterRestore = await call("read_page", { page_id: page.pageId });
  check("the restored page reads normally again", readAfterRestore.pageId === page.pageId);

  // A row is a page, so the same archive path applies — but the database's own
  // read path filters archived rows out, which is what this checks.
  const rowsBefore = await call("query_database", { database_id: fixture.databaseId });
  await call("delete_page", { page_id: row.pageId });
  const rowsAfter = await call("query_database", { database_id: fixture.databaseId });
  check(
    "archiving a row takes it out of the database",
    rowsBefore.some((r: { pageId: string }) => r.pageId === row.pageId) &&
      !rowsAfter.some((r: { pageId: string }) => r.pageId === row.pageId),
    `${rowsBefore.length} -> ${rowsAfter.length} row(s)`,
  );

  await call("restore_page", { page_id: row.pageId });
  const rowsRestored = await call("query_database", { database_id: fixture.databaseId });
  const restoredRow = rowsRestored.find((r: { pageId: string }) => r.pageId === row.pageId);
  check(
    "restoring the row brings its property values back with it",
    restoredRow?.properties.Status === "Done",
    JSON.stringify(restoredRow?.properties),
  );

  // The fixture's board view groups by Status, so deleting it must prune that
  // view — a view grouped by a property that no longer exists shows nothing.
  const propertyDeleted = await call("delete_property", {
    database_id: fixture.databaseId,
    property: "Status",
  });
  check(
    "delete_property prunes the views that referenced it",
    propertyDeleted.viewsUpdated >= 1,
    JSON.stringify(propertyDeleted),
  );
  const listedAfter = await call("list_databases");
  const fixtureAfter = listedAfter.find(
    (d: { databaseId: string }) => d.databaseId === fixture.databaseId,
  );
  check(
    "the deleted property is gone from the database",
    !fixtureAfter.properties.some((p: { name: string }) => p.name === "Status"),
  );

  const doomed = await call("create_page", { title: "MCP smoke permanent" });
  createdPageIds.push(doomed.pageId);
  const removed = await call("delete_page", { page_id: doomed.pageId, permanent: true });
  const readDoomed = (await client.callTool({
    name: "read_page",
    arguments: { page_id: doomed.pageId },
  })) as ToolResult;
  check(
    "a permanent delete removes the page outright",
    removed.mode === "deleted" && readDoomed.isError === true,
  );

  await call("delete_page", { page_id: fixture.databaseId });
  const listedAfterArchive = await call("list_databases");
  check(
    "an archived database stops being offered by list_databases",
    !listedAfterArchive.some((d: { databaseId: string }) => d.databaseId === fixture.databaseId),
  );

  const failure = (await client.callTool({
    name: "read_page",
    arguments: { page_id: "00000000-0000-0000-0000-000000000000" },
  })) as ToolResult;
  check("unknown page returns a tool error, not a crash", failure.isError === true);
} finally {
  await client.close();
  await deleteFixturePage(fixture.databaseId);

  // Clean up through the service role so a failed run leaves nothing behind.
  if (createdPageIds.length > 0 && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { persistSession: false } },
    );
    await admin.from("pages").delete().in("id", createdPageIds);
    console.log(`cleaned up ${createdPageIds.length} page(s)`);
  }
}

const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
