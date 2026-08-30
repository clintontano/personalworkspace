import { NextResponse } from "next/server";
import { hashToken, safeEqual, verifyPkce } from "@/lib/oauth/crypto";
import {
  consumeAuthorizationCode,
  getClient,
  issueTokens,
  oauthConfigured,
  rotateRefreshToken,
} from "@/lib/oauth/store";

/**
 * OAuth 2.1 token endpoint: authorization_code and refresh_token grants.
 *
 * Refresh tokens are rotated on every use and the previous grant revoked, as
 * OAuth 2.1 requires for public clients.
 */
export async function POST(request: Request) {
  if (!oauthConfigured()) {
    return fail("server_error", "OAuth storage is not configured", 500);
  }

  const form = await readForm(request);
  if (!form) return fail("invalid_request", "Expected form-encoded or JSON body");

  const grantType = form.get("grant_type");
  const clientId = form.get("client_id");
  if (!clientId) return fail("invalid_client", "client_id is required");

  const client = await getClient(clientId);
  if (!client) return fail("invalid_client", "Unknown client");

  // Confidential clients must prove possession of their secret.
  if (client.client_secret_hash) {
    const presented = form.get("client_secret");
    if (!presented || !safeEqual(hashToken(presented), client.client_secret_hash)) {
      return fail("invalid_client", "Bad client credentials", 401);
    }
  }

  if (grantType === "authorization_code") {
    const code = form.get("code");
    const verifier = form.get("code_verifier");
    const redirectUri = form.get("redirect_uri");
    if (!code || !verifier) {
      return fail("invalid_request", "code and code_verifier are required");
    }

    const record = await consumeAuthorizationCode(code);
    if (!record) return fail("invalid_grant", "Code is invalid, expired or already used");
    if (record.client_id !== clientId) {
      return fail("invalid_grant", "Code was issued to a different client");
    }
    if (redirectUri && redirectUri !== record.redirect_uri) {
      return fail("invalid_grant", "redirect_uri does not match the authorization request");
    }
    if (!verifyPkce(verifier, record.code_challenge, record.code_challenge_method)) {
      return fail("invalid_grant", "PKCE verification failed");
    }

    const tokens = await issueTokens({
      clientId,
      userId: record.user_id,
      resource: record.resource,
      scope: record.scope,
      supabaseRefreshToken: record.supabase_refresh_token,
    });
    return tokenResponse(tokens, record.scope);
  }

  if (grantType === "refresh_token") {
    const refreshToken = form.get("refresh_token");
    if (!refreshToken) return fail("invalid_request", "refresh_token is required");
    const tokens = await rotateRefreshToken(refreshToken, clientId);
    if (!tokens) return fail("invalid_grant", "Refresh token is invalid or revoked");
    return tokenResponse(tokens, null);
  }

  return fail("unsupported_grant_type", `Unsupported grant_type: ${grantType ?? "none"}`);
}

async function readForm(request: Request): Promise<Map<string, string> | null> {
  const contentType = request.headers.get("content-type") ?? "";
  try {
    if (contentType.includes("application/json")) {
      const body = (await request.json()) as Record<string, unknown>;
      return new Map(
        Object.entries(body)
          .filter(([, v]) => typeof v === "string")
          .map(([k, v]) => [k, v as string]),
      );
    }
    const data = await request.formData();
    return new Map(
      [...data.entries()]
        .filter(([, v]) => typeof v === "string")
        .map(([k, v]) => [k, v as string]),
    );
  } catch {
    return null;
  }
}

function tokenResponse(
  tokens: { accessToken: string; refreshToken: string; expiresIn: number },
  scope: string | null,
) {
  return NextResponse.json(
    {
      access_token: tokens.accessToken,
      token_type: "Bearer",
      expires_in: tokens.expiresIn,
      refresh_token: tokens.refreshToken,
      ...(scope ? { scope } : {}),
    },
    { headers: { "cache-control": "no-store", pragma: "no-cache" } },
  );
}

function fail(error: string, description: string, status = 400) {
  return NextResponse.json(
    { error, error_description: description },
    { status, headers: { "cache-control": "no-store" } },
  );
}
