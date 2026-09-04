import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { hashToken, randomToken } from "./crypto";

/**
 * Service-role access to the OAuth tables.
 *
 * These tables carry no role grants, so they are absent from the generated
 * Database types and unreachable from the browser by construction. They are
 * typed locally instead — the narrow surface here is the only thing that
 * touches them.
 */
export type OAuthClient = {
  client_id: string;
  client_secret_hash: string | null;
  client_name: string;
  redirect_uris: string[];
};

export type OAuthCode = {
  code_hash: string;
  client_id: string;
  user_id: string;
  redirect_uri: string;
  code_challenge: string;
  code_challenge_method: string;
  resource: string | null;
  scope: string | null;
  supabase_refresh_token: string;
  expires_at: string;
  consumed_at: string | null;
};

export type OAuthToken = {
  id: string;
  client_id: string;
  user_id: string;
  resource: string | null;
  scope: string | null;
  supabase_refresh_token: string;
  expires_at: string;
  revoked_at: string | null;
};

export const ACCESS_TOKEN_TTL_SECONDS = 60 * 60;
const CODE_TTL_SECONDS = 60 * 5;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function admin(): SupabaseClient<any, "public", any> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Remote MCP needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY",
    );
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function oauthConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY,
  );
}

export async function registerClient(args: {
  clientName: string;
  redirectUris: string[];
  wantsSecret: boolean;
}): Promise<{ clientId: string; clientSecret: string | null }> {
  const clientId = `mcp_${randomToken(16)}`;
  const clientSecret = args.wantsSecret ? randomToken(32) : null;

  const { error } = await admin()
    .from("oauth_clients")
    .insert({
      client_id: clientId,
      client_secret_hash: clientSecret ? hashToken(clientSecret) : null,
      client_name: args.clientName,
      redirect_uris: args.redirectUris,
    });
  if (error) throw error;
  return { clientId, clientSecret };
}

export async function getClient(clientId: string): Promise<OAuthClient | null> {
  const { data } = await admin()
    .from("oauth_clients")
    .select("client_id, client_secret_hash, client_name, redirect_uris")
    .eq("client_id", clientId)
    .maybeSingle();
  return (data as OAuthClient | null) ?? null;
}

export async function createAuthorizationCode(args: {
  clientId: string;
  userId: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  resource: string | null;
  scope: string | null;
  supabaseRefreshToken: string;
}): Promise<string> {
  const code = randomToken(32);
  const { error } = await admin()
    .from("oauth_codes")
    .insert({
      code_hash: hashToken(code),
      client_id: args.clientId,
      user_id: args.userId,
      redirect_uri: args.redirectUri,
      code_challenge: args.codeChallenge,
      code_challenge_method: args.codeChallengeMethod,
      resource: args.resource,
      scope: args.scope,
      supabase_refresh_token: args.supabaseRefreshToken,
      expires_at: new Date(Date.now() + CODE_TTL_SECONDS * 1000).toISOString(),
    });
  if (error) throw error;
  return code;
}

/**
 * Fetch and atomically consume an authorization code.
 *
 * The update is conditional on consumed_at still being null, so a replayed
 * code cannot be exchanged twice even if two requests race.
 */
export async function consumeAuthorizationCode(code: string): Promise<OAuthCode | null> {
  const codeHash = hashToken(code);
  const { data } = await admin()
    .from("oauth_codes")
    .select("*")
    .eq("code_hash", codeHash)
    .maybeSingle();
  const record = data as OAuthCode | null;
  if (!record) return null;
  if (record.consumed_at) return null;
  if (new Date(record.expires_at).getTime() < Date.now()) return null;

  const { data: claimed } = await admin()
    .from("oauth_codes")
    .update({ consumed_at: new Date().toISOString() })
    .eq("code_hash", codeHash)
    .is("consumed_at", null)
    .select("code_hash");
  if (!claimed || claimed.length === 0) return null;
  return record;
}

export async function issueTokens(args: {
  clientId: string;
  userId: string;
  resource: string | null;
  scope: string | null;
  supabaseRefreshToken: string;
}): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
  const accessToken = randomToken(32);
  const refreshToken = randomToken(32);
  const { error } = await admin()
    .from("oauth_tokens")
    .insert({
      access_token_hash: hashToken(accessToken),
      refresh_token_hash: hashToken(refreshToken),
      client_id: args.clientId,
      user_id: args.userId,
      resource: args.resource,
      scope: args.scope,
      supabase_refresh_token: args.supabaseRefreshToken,
      expires_at: new Date(Date.now() + ACCESS_TOKEN_TTL_SECONDS * 1000).toISOString(),
    });
  if (error) throw error;
  return { accessToken, refreshToken, expiresIn: ACCESS_TOKEN_TTL_SECONDS };
}

/**
 * Store the refresh token Supabase handed back on the last refresh.
 *
 * Conditional on the value having changed, so two concurrent MCP requests
 * that both refreshed do not clobber each other pointlessly. Returns whether
 * this call was the one that wrote; callers treat false as "someone else got
 * there first", not as an error.
 */
export async function updateSupabaseRefreshToken(
  tokenId: string,
  refreshToken: string,
): Promise<boolean> {
  const { data, error } = await admin()
    .from("oauth_tokens")
    .update({ supabase_refresh_token: refreshToken })
    .eq("id", tokenId)
    .neq("supabase_refresh_token", refreshToken)
    .select("id");
  if (error) throw error;
  return Boolean(data && data.length > 0);
}

export async function findAccessToken(token: string): Promise<OAuthToken | null> {
  const { data } = await admin()
    .from("oauth_tokens")
    .select("*")
    .eq("access_token_hash", hashToken(token))
    .maybeSingle();
  const record = data as OAuthToken | null;
  if (!record || record.revoked_at) return null;
  if (new Date(record.expires_at).getTime() < Date.now()) return null;
  return record;
}

/** Rotate a refresh token, revoking the old grant (OAuth 2.1 requires rotation). */
export async function rotateRefreshToken(
  refreshToken: string,
  clientId: string,
): Promise<{ accessToken: string; refreshToken: string; expiresIn: number } | null> {
  const { data } = await admin()
    .from("oauth_tokens")
    .select("*")
    .eq("refresh_token_hash", hashToken(refreshToken))
    .maybeSingle();
  const record = data as OAuthToken | null;
  if (!record || record.revoked_at || record.client_id !== clientId) return null;

  await admin()
    .from("oauth_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", record.id);

  // Re-read the Supabase refresh token rather than carrying the value
  // captured above: an MCP request may have rotated and written it back since
  // this row was selected, and copying the stale one forward would hand the
  // new grant a dead token.
  const { data: latest } = await admin()
    .from("oauth_tokens")
    .select("supabase_refresh_token")
    .eq("id", record.id)
    .maybeSingle();

  return issueTokens({
    clientId: record.client_id,
    userId: record.user_id,
    resource: record.resource,
    scope: record.scope,
    supabaseRefreshToken:
      (latest as { supabase_refresh_token?: string } | null)?.supabase_refresh_token ??
      record.supabase_refresh_token,
  });
}
