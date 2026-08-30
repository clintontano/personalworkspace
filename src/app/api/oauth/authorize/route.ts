import { NextResponse, type NextRequest } from "next/server";
import {
  canonicalResource,
  isRegisteredRedirect,
  resourceMatches,
} from "@/lib/oauth/crypto";
import { createAuthorizationCode, getClient, oauthConfigured } from "@/lib/oauth/store";
import { createClient } from "@/lib/supabase/server";

/**
 * OAuth 2.1 authorization endpoint.
 *
 * The user must already be signed into the app; if not they are sent to
 * /login and returned here. Their Supabase refresh token is captured with the
 * grant so the MCP endpoint can act as them under their own RLS rather than
 * falling back to the service role.
 *
 * Errors are only redirected back to the client once the redirect_uri has
 * been validated against the registration — otherwise they are rendered here,
 * so a bad redirect_uri can never be used to bounce a code somewhere else.
 */
export async function GET(request: NextRequest) {
  if (!oauthConfigured()) {
    return problem("Remote MCP is not configured on this deployment.", 500);
  }

  const params = request.nextUrl.searchParams;
  const clientId = params.get("client_id");
  const redirectUri = params.get("redirect_uri");
  const responseType = params.get("response_type");
  const codeChallenge = params.get("code_challenge");
  const codeChallengeMethod = params.get("code_challenge_method") ?? "S256";
  const state = params.get("state");
  const scope = params.get("scope");
  const resource = params.get("resource");

  if (!clientId || !redirectUri) {
    return problem("Missing client_id or redirect_uri.", 400);
  }

  const client = await getClient(clientId);
  if (!client) return problem("Unknown client_id. Register the client first.", 400);

  // Validate the redirect before it is ever used as a redirect target.
  if (!isRegisteredRedirect(redirectUri, client.redirect_uris)) {
    return problem("redirect_uri does not match this client's registration.", 400);
  }

  const fail = (error: string, description: string) => {
    const url = new URL(redirectUri);
    url.searchParams.set("error", error);
    url.searchParams.set("error_description", description);
    if (state) url.searchParams.set("state", state);
    return NextResponse.redirect(url);
  };

  if (responseType !== "code") {
    return fail("unsupported_response_type", "Only the authorization code flow is supported.");
  }
  if (!codeChallenge || codeChallengeMethod !== "S256") {
    return fail("invalid_request", "PKCE with S256 is required.");
  }

  // Audience binding: only mint tokens for this deployment's MCP endpoint.
  const expected = `${request.nextUrl.origin}/api/mcp`;
  if (resource && !resourceMatches(resource, expected)) {
    return fail("invalid_target", `This server only issues tokens for ${expected}.`);
  }

  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    // Sign in, then come back to this exact authorization request.
    const login = new URL("/login", request.nextUrl.origin);
    login.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search);
    return NextResponse.redirect(login);
  }

  const code = await createAuthorizationCode({
    clientId,
    userId: session.user.id,
    redirectUri,
    codeChallenge,
    codeChallengeMethod,
    resource: resource ? canonicalResource(resource) : canonicalResource(expected),
    scope,
    supabaseRefreshToken: session.refresh_token,
  });

  const destination = new URL(redirectUri);
  destination.searchParams.set("code", code);
  if (state) destination.searchParams.set("state", state);
  return NextResponse.redirect(destination);
}

/** Render an error here rather than redirecting somewhere unvalidated. */
function problem(message: string, status: number) {
  return new NextResponse(
    `<!doctype html><meta charset="utf-8"><title>Authorization failed</title>` +
      `<body style="font:14px system-ui;padding:2rem;max-width:40rem">` +
      `<h1 style="font-size:1.1rem">Authorization failed</h1><p>${message}</p></body>`,
    { status, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}
