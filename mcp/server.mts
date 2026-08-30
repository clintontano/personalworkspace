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
import type { Database } from "../src/lib/database.types.js";
import * as api from "../src/lib/mcp/api.js";
import { registerWorkspaceTools } from "../src/lib/mcp/tools.js";

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

async function main() {
  // The same registrations the remote /api/mcp route uses.
  const { supabase } = await connect();
  await registerWorkspaceTools(server, supabase);
  await server.connect(new StdioServerTransport());
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
