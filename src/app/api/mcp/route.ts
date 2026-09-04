import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/lib/database.types";
import { registerWorkspaceTools } from "@/lib/mcp/tools";
import { resourceMatches } from "@/lib/oauth/crypto";
import { openUserSession } from "@/lib/oauth/session";
import {
  findAccessToken,
  oauthConfigured,
  updateSupabaseRefreshToken,
} from "@/lib/oauth/store";

// The MCP session is per-request; nothing is cached between invocations.
export const dynamic = "force-dynamic";

/**
 * Remote MCP endpoint (Streamable HTTP).
 *
 * Every request must carry a bearer token issued by this deployment's
 * authorization server. The token is bound to the user who approved it, and
 * the Supabase client is built from *their* session — so the remote server
 * has exactly the access the local stdio server does, under the same RLS,
 * and never touches the service-role key for workspace data.
 */
async function handle(request: NextRequest): Promise<Response> {
  if (!oauthConfigured()) {
    return NextResponse.json(
      { error: "server_error", error_description: "Remote MCP is not configured" },
      { status: 500 },
    );
  }

  const origin = request.nextUrl.origin;
  const resourceMetadata = `${origin}/.well-known/oauth-protected-resource`;
  const challenge = `Bearer resource_metadata="${resourceMetadata}"`;

  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) {
    // The WWW-Authenticate header is how the client discovers where to
    // authorize (RFC 9728 section 5.1).
    return unauthorized("Missing bearer token", challenge);
  }

  const token = await findAccessToken(match[1]);
  if (!token) return unauthorized("Token is invalid or expired", challenge);

  // Audience binding: refuse a token that was minted for another resource.
  if (!resourceMatches(token.resource, `${origin}/api/mcp`)) {
    return unauthorized("Token was not issued for this resource", challenge);
  }

  // Supabase rotates the refresh token on use; openUserSession writes the new
  // value back so the next request is not left holding a revoked one.
  const supabase = await openUserSession(token, refreshUserSession, (id, next) =>
    updateSupabaseRefreshToken(id, next),
  );
  if (!supabase) {
    return unauthorized("The workspace session behind this token has expired", challenge);
  }

  const server = new McpServer({ name: "personalworkspace", version: "0.1.0" });
  await registerWorkspaceTools(server, supabase);

  const transport = new WebStandardStreamableHTTPServerTransport({
    // Stateless: each request carries its own auth and builds its own server,
    // which is what a serverless deployment can actually guarantee.
    sessionIdGenerator: undefined,
    // Return a complete JSON body rather than opening an SSE stream. A
    // serverless function cannot keep a stream alive between invocations, and
    // closing the transport to release it truncated the response.
    enableJsonResponse: true,
  });
  await server.connect(transport);

  return transport.handleRequest(request);
}

/**
 * A Supabase client acting as the user who authorized this token, plus the
 * rotated refresh token to store.
 *
 * Deliberately the anon key: workspace reads and writes go through the user's
 * own session so RLS still applies. The service role is used only for the
 * OAuth tables.
 */
async function refreshUserSession(
  refreshToken: string,
): Promise<{ client: SupabaseClient<Database>; refreshToken: string } | null> {
  const client = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { data, error } = await client.auth.refreshSession({ refresh_token: refreshToken });
  if (error || !data.session) return null;
  return { client, refreshToken: data.session.refresh_token };
}

function unauthorized(description: string, challenge: string) {
  return NextResponse.json(
    { error: "invalid_token", error_description: description },
    { status: 401, headers: { "www-authenticate": challenge } },
  );
}

export const GET = handle;
export const POST = handle;
export const DELETE = handle;
