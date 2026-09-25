import { NextResponse } from "next/server";
import { hashToken, safeEqual, verifyPkce } from "@/lib/oauth/crypto";
import {
  consumeAuthorizationCode,
  createGrant,
  exchangeRefreshToken,
  getClient,
  issueTokens,
  oauthConfigured,
} from "@/lib/oauth/store";
import { mintUserSession } from "@/lib/oauth/supabase-session";

/**
 * OAuth 2.1 token endpoint: authorization_code and refresh_token grants.
 *
 * The code exchange mints the grant's own Supabase session. Refresh tokens
 * rotate on every use, but a rotated one stays exchangeable until its
 * successor is used, so a client that lost a response can retry instead of
 * being stranded (refresh-policy.ts).
 *
 * invalid_grant is reserved for "this grant is over": it makes the client
 * discard its tokens. A database or auth failure answers 503 instead, which a
 * client retries with its tokens intact.
 */
export async function POST(request: Request) {
  if (!oauthConfigured()) {
    return fail("server_error", "OAuth storage is not configured", 500);
  }
  try {
    return await exchange(request);
  } catch (error) {
    console.error("oauth token: dependency failure", error);
    return fail("temporarily_unavailable", "Try again shortly", 503);
  }
}

async function exchange(request: Request): Promise<Response> {
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

    // A session for this grant alone. Copying the browser's instead is what
    // let the two trip Supabase's reuse detection and revoke each other.
    const minted = await mintUserSession(record.user_id);
    if (!minted.ok) {
      return fail("invalid_grant", `Could not open a workspace session: ${minted.reason}`);
    }
    const grant = await createGrant({
      clientId,
      userId: record.user_id,
      resource: record.resource,
      scope: record.scope,
      session: minted.session,
    });
    const tokens = await issueTokens(grant, null);
    return tokenResponse(tokens, record.scope);
  }

  if (grantType === "refresh_token") {
    const refreshToken = form.get("refresh_token");
    if (!refreshToken) return fail("invalid_request", "refresh_token is required");
    const result = await exchangeRefreshToken(refreshToken, clientId);
    if (!result.ok) return fail("invalid_grant", result.reason);
    return tokenResponse(result.tokens, result.scope);
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
    {
      status,
      headers: {
        "cache-control": "no-store",
        ...(status === 503 ? { "retry-after": "5" } : {}),
      },
    },
  );
}
