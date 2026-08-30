import { NextResponse } from "next/server";
import { isAllowedRedirectUri } from "@/lib/oauth/crypto";
import { oauthConfigured, registerClient } from "@/lib/oauth/store";

/**
 * Dynamic Client Registration (RFC 7591).
 *
 * MCP clients register themselves rather than the user copying credentials
 * around. Registration is open, which is what the spec intends: holding a
 * client id grants nothing on its own — every token still requires the user
 * to sign in and approve the connection.
 */
export async function POST(request: Request) {
  if (!oauthConfigured()) {
    return NextResponse.json(
      { error: "server_error", error_description: "OAuth storage is not configured" },
      { status: 500 },
    );
  }

  let body: {
    client_name?: string;
    redirect_uris?: unknown;
    token_endpoint_auth_method?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_client_metadata" }, { status: 400 });
  }

  const redirectUris = Array.isArray(body.redirect_uris)
    ? body.redirect_uris.filter((u): u is string => typeof u === "string")
    : [];

  if (redirectUris.length === 0) {
    return NextResponse.json(
      { error: "invalid_redirect_uri", error_description: "redirect_uris is required" },
      { status: 400 },
    );
  }
  const bad = redirectUris.find((uri) => !isAllowedRedirectUri(uri));
  if (bad) {
    return NextResponse.json(
      {
        error: "invalid_redirect_uri",
        error_description: `redirect_uri must be https, or http on loopback: ${bad}`,
      },
      { status: 400 },
    );
  }

  const wantsSecret = body.token_endpoint_auth_method !== "none";
  const { clientId, clientSecret } = await registerClient({
    clientName: typeof body.client_name === "string" ? body.client_name : "MCP client",
    redirectUris,
    wantsSecret,
  });

  return NextResponse.json(
    {
      client_id: clientId,
      ...(clientSecret ? { client_secret: clientSecret } : {}),
      client_name: body.client_name ?? "MCP client",
      redirect_uris: redirectUris,
      token_endpoint_auth_method: wantsSecret ? "client_secret_post" : "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    },
    { status: 201 },
  );
}
