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

export type ToolContext = {
  supabase: SupabaseClient<Database>;
  workspaceId: string;
};

/** Register every workspace tool on `server`, acting as `supabase`. */
export async function registerWorkspaceTools(
  server: McpServer,
  supabase: SupabaseClient<Database>,
): Promise<void> {
  const ctx: ToolContext = {
    supabase,
    workspaceId: await api.currentWorkspaceId(supabase),
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
}
