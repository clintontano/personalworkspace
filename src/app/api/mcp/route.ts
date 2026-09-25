import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { NextResponse, type NextRequest } from "next/server";
import { registerWorkspaceTools } from "@/lib/mcp/tools";
import { resourceMatches } from "@/lib/oauth/crypto";
import { openGrantSession } from "@/lib/oauth/grant-session";
import { canonicalOrigin } from "@/lib/oauth/origin";
import {
  findAccessToken,
  loadGrant,
  markTokenUsed,
  oauthConfigured,
  revokeGrant,
  saveGrantSession,
} from "@/lib/oauth/store";
import { refreshSupabaseSession, userScopedClient } from "@/lib/oauth/supabase-session";

// The MCP session is per-request; nothing is cached between invocations.
export const dynamic = "force-dynamic";

/**
 * Remote MCP endpoint (Streamable HTTP).
 *
 * Every request must carry a bearer token issued by this deployment's
 * authorization server. The token belongs to a grant, and the grant owns a
 * Supabase session minted for it alone — so the remote server has exactly the
 * access the local stdio server does, under the same RLS, and never touches
 * the service-role key for workspace data.
 *
 * Status codes matter to the client here:
 * - 401 with `error="invalid_token"` means refresh, or re-authorize if the
 *   refresh is refused.
 * - 503 means a dependency hiccuped: retry with the same token. Answering 401
 *   for that would have the client burn a refresh for nothing, or worse.
 */
async function handle(request: NextRequest): Promise<Response> {
  if (!oauthConfigured()) {
    return NextResponse.json(
      { error: "server_error", error_description: "Remote MCP is not configured" },
      { status: 500 },
    );
  }

  const origin = canonicalOrigin(request.nextUrl.origin);
  const resourceMetadata = `${origin}/.well-known/oauth-protected-resource`;

  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) {
    // No error code when no credentials were sent (RFC 6750 section 3.1); the
    // header is how the client discovers where to authorize (RFC 9728 5.1).
    return unauthorized(`Bearer resource_metadata="${resourceMetadata}"`, "Missing bearer token");
  }

  const invalid = (description: string) =>
    unauthorized(
      `Bearer error="invalid_token", error_description="${description}", resource_metadata="${resourceMetadata}"`,
      description,
    );

  try {
    const found = await findAccessToken(match[1]);
    if (!found) return invalid("Token is invalid or expired");
    const { token, grant } = found;

    // Audience binding: refuse a token that was minted for another resource.
    if (!resourceMatches(token.resource, `${origin}/api/mcp`)) {
      return invalid("Token was not issued for this resource");
    }

    // Grants from before the fix borrowed the browser's session. Refusing
    // them here, and their refresh tokens at /token, sends the client through
    // one clean re-authorization.
    if (!grant) return invalid("This connection predates a session fix; reconnect");

    const opened = await openGrantSession(grant, {
      loadGrant,
      refresh: refreshSupabaseSession,
      saveSession: saveGrantSession,
      revokeGrant,
      now: Date.now,
    });
    if (!opened.ok) {
      return invalid("The workspace session behind this connection has ended; reconnect");
    }

    await markTokenUsed(token);

    const server = new McpServer({ name: "personalworkspace", version: "0.1.0" });
    await registerWorkspaceTools(server, userScopedClient(opened.accessToken), {
      userId: opened.userId,
    });

    const transport = new WebStandardStreamableHTTPServerTransport({
      // Stateless: each request carries its own auth and builds its own
      // server, which is what a serverless deployment can actually guarantee.
      sessionIdGenerator: undefined,
      // Return a complete JSON body rather than opening an SSE stream. A
      // serverless function cannot keep a stream alive between invocations,
      // and closing the transport to release it truncated the response.
      enableJsonResponse: true,
    });
    await server.connect(transport);
    return transport.handleRequest(request);
  } catch (error) {
    // Database or Supabase auth unavailable. The grant is untouched.
    console.error("mcp: dependency failure", error);
    return NextResponse.json(
      { error: "temporarily_unavailable", error_description: "Try again shortly" },
      { status: 503, headers: { "retry-after": "5" } },
    );
  }
}

function unauthorized(challenge: string, description: string) {
  return NextResponse.json(
    { error: "invalid_token", error_description: description },
    { status: 401, headers: { "www-authenticate": challenge } },
  );
}

export const GET = handle;
export const POST = handle;
export const DELETE = handle;
