import { NextResponse, type NextRequest } from "next/server";

/**
 * OAuth 2.0 Authorization Server Metadata (RFC 8414).
 *
 * Only S256 PKCE and the authorization-code grant are advertised: OAuth 2.1
 * drops implicit and password grants, and "plain" PKCE offers no protection
 * against a stolen code.
 */
export function GET(request: NextRequest) {
  const origin = request.nextUrl.origin;
  return NextResponse.json(
    {
      issuer: origin,
      authorization_endpoint: `${origin}/api/oauth/authorize`,
      token_endpoint: `${origin}/api/oauth/token`,
      registration_endpoint: `${origin}/api/oauth/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["client_secret_post", "none"],
      scopes_supported: ["workspace"],
    },
    { headers: { "cache-control": "public, max-age=300" } },
  );
}
