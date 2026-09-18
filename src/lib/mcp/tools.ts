/**
 * The workspace tool surface, shared by both MCP servers.
 *
 * `mcp/server.mts` runs it over stdio for local use; `/api/mcp` runs the same
 * registrations over Streamable HTTP for the remote connector. Defining them
 * once means the two cannot drift.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/lib/database.types";
import * as api from "@/lib/mcp/api";
import {
  clearRowValues,
  deleteBlocks,
  deleteDatabaseProperty,
  deletePage,
  listArchivedPages,
  restorePage,
} from "@/lib/mcp/delete";

export type ToolContext = {
  supabase: SupabaseClient<Database>;
  workspaceId: string;
};

/**
 * Register every workspace tool on `server`, acting as `supabase`. Pass
 * `userId` when the client carries only an access token.
 */
export async function registerWorkspaceTools(
  server: McpServer,
  supabase: SupabaseClient<Database>,
  options: { userId?: string } = {},
): Promise<void> {
  const ctx: ToolContext = {
    supabase,
    workspaceId: await api.currentWorkspaceId(supabase, options.userId),
  };

  const ok = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
  });

  /** Tool bodies return data or throw; failures come back as tool errors. */
  function tool<Args>(handler: (args: Args, ctx: ToolContext) => Promise<unknown>) {
    return async (args: Args) => {
      try {
        return ok(await handler(args, ctx));
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
    inputSchema: {
      page_id: z.string().describe("page id from search or list_databases"),
      include_block_ids: z
        .boolean()
        .optional()
        .describe("also list each block's id, for delete_blocks"),
    },
  },
  tool<{ page_id: string; include_block_ids?: boolean }>(
    async ({ page_id, include_block_ids }, { supabase }) =>
      api.readPage(supabase, page_id, { includeBlockIds: include_block_ids }),
  ),
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

  // Destructive tools ------------------------------------------------------
  // Deleting a page archives it by default: an agent acting on a misread
  // instruction should not be able to destroy a page tree, and `restore_page`
  // gives the way back. `permanent` is the explicit opt out.

  server.registerTool(
  "delete_page",
  {
    title: "Delete a page",
    description:
      "Archive a page, or delete it outright with permanent: true. Archiving is reversible with restore_page; a permanent delete is not. Sub-pages go with it either way, so deleting a database also removes its rows, and deleting a row deletes that row's page. Works on ordinary pages, database pages and rows alike.",
    annotations: { destructiveHint: true, idempotentHint: true },
    inputSchema: {
      page_id: z.string(),
      permanent: z
        .boolean()
        .optional()
        .describe("delete outright instead of archiving; cannot be undone"),
    },
  },
  tool<{ page_id: string; permanent?: boolean }>(async ({ page_id, permanent }, { supabase }) =>
    deletePage(supabase, page_id, { permanent }),
  ),
  );

  server.registerTool(
  "restore_page",
  {
    title: "Restore an archived page",
    description:
      "Un-archive a page, along with whatever was archived in the same operation. Page ids come from list_trash. Reports hiddenUnder when the page is back but still sits under an archived ancestor.",
    annotations: { idempotentHint: true },
    inputSchema: { page_id: z.string() },
  },
  tool<{ page_id: string }>(async ({ page_id }, { supabase }) => restorePage(supabase, page_id)),
  );

  server.registerTool(
  "list_trash",
  {
    title: "List archived pages",
    description:
      "Archived pages, newest first. isRoot marks the page a restore should aim at — the others came along with it. Archived pages are hidden from search and list_databases, so this is the only way to find them.",
    annotations: { readOnlyHint: true },
    inputSchema: { limit: z.number().int().min(1).max(200).optional() },
  },
  tool<{ limit?: number }>(async ({ limit }, { supabase, workspaceId }) =>
    listArchivedPages(supabase, workspaceId, limit ?? 50),
  ),
  );

  server.registerTool(
  "clear_cells",
  {
    title: "Clear cells on a row",
    description:
      "Empty named property values on a database row, leaving the row itself in place. Properties may be referenced by name. To remove the whole row use delete_page.",
    annotations: { destructiveHint: true, idempotentHint: true },
    inputSchema: {
      page_id: z.string().describe("the row's page id"),
      properties: z.array(z.string()).min(1).describe("property names or ids to empty"),
    },
  },
  tool<{ page_id: string; properties: string[] }>(async ({ page_id, properties }, { supabase }) =>
    clearRowValues(supabase, page_id, properties),
  ),
  );

  server.registerTool(
  "delete_property",
  {
    title: "Delete a database property",
    description:
      "Delete a property (a column) from a database, and prune it out of that database's views. Cannot be undone: the values stored under it in existing rows stop being readable.",
    annotations: { destructiveHint: true },
    inputSchema: {
      database_id: z.string(),
      property: z.string().describe("property name or id"),
    },
  },
  tool<{ database_id: string; property: string }>(async ({ database_id, property }, { supabase }) =>
    deleteDatabaseProperty(supabase, database_id, property),
  ),
  );

  server.registerTool(
  "delete_blocks",
  {
    title: "Delete blocks from a page",
    description:
      "Delete content blocks from a page: pass block_ids, or all: true to empty the page body. Nested blocks go with their parent. Cannot be undone. Get ids from read_page with include_block_ids: true.",
    annotations: { destructiveHint: true },
    inputSchema: {
      page_id: z.string(),
      block_ids: z.array(z.string()).optional(),
      all: z.boolean().optional().describe("delete every block on the page"),
    },
  },
  tool<{ page_id: string; block_ids?: string[]; all?: boolean }>(
    async ({ page_id, block_ids, all }, { supabase }) =>
      deleteBlocks(supabase, page_id, { blockIds: block_ids, all }),
  ),
  );
}
