#!/usr/bin/env node
/**
 * MCP server for the personal workspace (local stdio).
 *
 * Signs in with the workspace owner's credentials, so every tool call runs
 * under that user's RLS — the server has no privileged access.
 *
 * Configure in Claude Code / Claude Desktop:
 *   {
 *     "mcpServers": {
 *       "workspace": {
 *         "command": "npx",
 *         "args": ["tsx", "<repo>/mcp/server.ts"]
 *       }
 *     }
 *   }
 * Credentials come from .env.local (MCP_USER_EMAIL/PASSWORD, falling back to
 * SEED_USER_EMAIL/PASSWORD).
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { config } from "dotenv";
import { z } from "zod";
import type { Database } from "../src/lib/database.types.js";
import * as api from "../src/lib/mcp/api.js";

const here = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.join(here, "..", ".env.local"), quiet: true });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const email = process.env.MCP_USER_EMAIL ?? process.env.SEED_USER_EMAIL;
const password = process.env.MCP_USER_PASSWORD ?? process.env.SEED_USER_PASSWORD;

if (!url || !anonKey || !email || !password) {
  console.error(
    "Missing config. .env.local needs NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and MCP_USER_EMAIL/MCP_USER_PASSWORD (or SEED_USER_*).",
  );
  process.exit(1);
}

let clientPromise: Promise<{ supabase: SupabaseClient<Database>; workspaceId: string }> | null = null;

/** Sign in lazily and reuse the session for the process lifetime. */
function connect() {
  clientPromise ??= (async () => {
    const supabase = createClient<Database>(url!, anonKey!, {
      auth: { persistSession: false, autoRefreshToken: true },
    });
    const { error } = await supabase.auth.signInWithPassword({
      email: email!,
      password: password!,
    });
    if (error) throw new Error(`sign-in failed: ${error.message}`);
    const workspaceId = await api.currentWorkspaceId(supabase);
    return { supabase, workspaceId };
  })();
  return clientPromise;
}

const server = new McpServer({ name: "personalworkspace", version: "0.1.0" });

const ok = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
});

/** Tool bodies return data or throw; failures come back as tool errors. */
function tool<Args>(handler: (args: Args, ctx: Awaited<ReturnType<typeof connect>>) => Promise<unknown>) {
  return async (args: Args) => {
    try {
      return ok(await handler(args, await connect()));
    } catch (error) {
      return {
        isError: true,
        content: [{ type: "text" as const, text: `Error: ${(error as Error).message}` }],
      };
    }
  };
}

const filterSchema = z
  .object({
    combinator: z.enum(["and", "or"]).default("and"),
    conditions: z
      .array(
        z.object({
          property: z.string().describe("property name or id, or \"title\""),
          op: z.enum([
            "eq", "ne", "contains", "not_contains", "is_empty", "is_not_empty",
            "gt", "gte", "lt", "lte", "before", "after", "on",
          ]),
          value: z.union([z.string(), z.number(), z.boolean()]).optional(),
        }),
      )
      .default([]),
  })
  .describe("Filter group; property may be a name or id");

server.registerTool(
  "search",
  {
    title: "Search the workspace",
    description:
      "Full-text search across page titles and block content. Returns page ids to use with read_page.",
    inputSchema: { query: z.string(), limit: z.number().int().min(1).max(50).optional() },
  },
  tool<{ query: string; limit?: number }>(async ({ query, limit }, { supabase }) =>
    api.search(supabase, query, limit ?? 20),
  ),
);

server.registerTool(
  "read_page",
  {
    title: "Read a page",
    description:
      "Read a page as markdown, with its sub-pages and (for database rows) its property values.",
    inputSchema: { page_id: z.string().describe("page id from search or list_databases") },
  },
  tool<{ page_id: string }>(async ({ page_id }, { supabase }) => api.readPage(supabase, page_id)),
);

server.registerTool(
  "create_page",
  {
    title: "Create a page",
    description: "Create a page, optionally nested under a parent and with markdown content.",
    inputSchema: {
      title: z.string(),
      markdown: z.string().optional(),
      parent_page_id: z.string().optional(),
      icon: z.string().optional().describe("a single emoji"),
    },
  },
  tool<{ title: string; markdown?: string; parent_page_id?: string; icon?: string }>(
    async (args, { supabase, workspaceId }) =>
      api.createPage(supabase, workspaceId, {
        title: args.title,
        markdown: args.markdown,
        parentPageId: args.parent_page_id ?? null,
        icon: args.icon,
      }),
  ),
);

server.registerTool(
  "append_blocks",
  {
    title: "Append to a page",
    description:
      "Append markdown to the end of a page. Headings, lists, checkboxes, quotes and fenced code become real blocks; two-space indentation nests.",
    inputSchema: { page_id: z.string(), markdown: z.string() },
  },
  tool<{ page_id: string; markdown: string }>(async ({ page_id, markdown }, { supabase, workspaceId }) =>
    api.appendBlocks(supabase, workspaceId, page_id, markdown),
  ),
);

server.registerTool(
  "list_databases",
  {
    title: "List databases",
    description: "List databases with their properties and select options. Start here to query rows.",
    inputSchema: {},
  },
  tool(async (_args, { supabase, workspaceId }) => api.listDatabases(supabase, workspaceId)),
);

server.registerTool(
  "query_database",
  {
    title: "Query a database",
    description:
      "List rows of a database with optional filters and sorts. Properties may be referenced by name.",
    inputSchema: {
      database_id: z.string(),
      filter: filterSchema.optional(),
      sorts: z
        .array(z.object({ property: z.string(), direction: z.enum(["asc", "desc"]).default("asc") }))
        .optional(),
      limit: z.number().int().min(1).max(200).optional(),
    },
  },
  tool<{
    database_id: string;
    filter?: { combinator: "and" | "or"; conditions: unknown[] };
    sorts?: { property: string; direction: "asc" | "desc" }[];
    limit?: number;
  }>(async (args, { supabase }) =>
    api.queryDatabase(supabase, args.database_id, {
      filter: args.filter as never,
      sorts: args.sorts,
      limit: args.limit,
    }),
  ),
);

server.registerTool(
  "create_row",
  {
    title: "Create a database row",
    description:
      "Create a row in a database. Property values may use names (\"Status\": \"Done\") and are coerced to the stored format. Rows are pages, so markdown content is allowed.",
    inputSchema: {
      database_id: z.string(),
      title: z.string(),
      properties: z.record(z.string(), z.unknown()).optional(),
      markdown: z.string().optional(),
    },
  },
  tool<{ database_id: string; title: string; properties?: Record<string, unknown>; markdown?: string }>(
    async (args, { supabase, workspaceId }) =>
      api.createRow(supabase, workspaceId, args.database_id, {
        title: args.title,
        properties: args.properties,
        markdown: args.markdown,
      }),
  ),
);

server.registerTool(
  "update_row_properties",
  {
    title: "Update a row",
    description:
      "Update property values (and optionally the title) of a database row. Properties may be referenced by name.",
    inputSchema: {
      page_id: z.string(),
      properties: z.record(z.string(), z.unknown()),
      title: z.string().optional(),
    },
  },
  tool<{ page_id: string; properties: Record<string, unknown>; title?: string }>(
    async (args, { supabase }) =>
      api.updateRowProperties(supabase, args.page_id, args.properties, args.title),
  ),
);

async function main() {
  await server.connect(new StdioServerTransport());
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
