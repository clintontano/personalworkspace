import { NextResponse, type NextRequest } from "next/server";

/**
 * OAuth 2.0 Protected Resource Metadata (RFC 9728).
 *
 * The MCP client fetches this after a 401 to learn which authorization
 * server issues tokens for this resource. Both the app itself and the
 * authorization server are this deployment.
 */
export function GET(request: NextRequest) {
  const origin = request.nextUrl.origin;
  return NextResponse.json(
    {
      resource: `${origin}/api/mcp`,
      authorization_servers: [origin],
      bearer_methods_supported: ["header"],
      scopes_supported: ["workspace"],
      resource_name: "Personal Workspace MCP",
    },
    { headers: { "cache-control": "public, max-age=300" } },
  );
}
