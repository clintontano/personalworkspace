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

try {
  const { tools } = await client.listTools();
  const expected = [
    "search", "read_page", "create_page", "append_blocks",
    "list_databases", "query_database", "create_row", "update_row_properties",
  ];
  const names = tools.map((t) => t.name);
  check("all tools exposed", expected.every((t) => names.includes(t)), names.join(", "));

  const databases = await call("list_databases");
  const tasks = databases.find((d: { title: string }) => d.title === "Tasks");
  check("list_databases finds Tasks", Boolean(tasks));

  const todo = await call("query_database", {
    database_id: tasks.databaseId,
    filter: { combinator: "and", conditions: [{ property: "Status", op: "eq", value: "To do" }] },
  });
  check(
    "query_database filters by property name",
    Array.isArray(todo) && todo.length > 0,
    `${todo.length} row(s)`,
  );

  const row = await call("create_row", {
    database_id: tasks.databaseId,
    title: "MCP smoke row",
    properties: { Status: "In progress", Tags: ["Work"], Due: "2026-09-15" },
    markdown: "## Notes\n\nCreated by **MCP**.\n\n- [ ] round trip",
  });
  createdPageIds.push(row.pageId);

  const read = await call("read_page", { page_id: row.pageId });
  check(
    "create_row coerces property names to stored values",
    read.properties.Status === "In progress" &&
      Array.isArray(read.properties.Tags) &&
      read.properties.Tags[0] === "Work",
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

  const failure = (await client.callTool({
    name: "read_page",
    arguments: { page_id: "00000000-0000-0000-0000-000000000000" },
  })) as ToolResult;
  check("unknown page returns a tool error, not a crash", failure.isError === true);
} finally {
  await client.close();

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
