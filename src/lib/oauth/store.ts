import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { hashToken, randomToken } from "./crypto";
import type { GrantRecord, SupabaseSession } from "./grant-session";
import { refreshRefusal } from "./refresh-policy";

/**
 * Service-role access to the OAuth tables.
 *
 * These tables carry no role grants, so they are absent from the generated
 * Database types and unreachable from the browser by construction. They are
 * typed locally instead — the narrow surface here is the only thing that
 * touches them.
 *
 * Every database error throws rather than reading as "not found". The routes
 * turn a throw into 503, which a client retries; "not found" becomes
 * invalid_grant, which makes it throw its tokens away. Conflating the two let
 * a momentary blip end a connection for good.
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
  expires_at: string;
  consumed_at: string | null;
};

export type Grant = GrantRecord & {
  client_id: string;
  resource: string | null;
  scope: string | null;
};

export type OAuthToken = {
  id: string;
  client_id: string;
  user_id: string;
  grant_id: string | null;
  parent_id: string | null;
  resource: string | null;
  scope: string | null;
  expires_at: string;
  revoked_at: string | null;
  rotated_at: string | null;
  used_at: string | null;
};

export type IssuedTokens = { accessToken: string; refreshToken: string; expiresIn: number };

/** Access tokens last an hour. Refresh tokens do not expire; they rotate. */
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
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY &&
      process.env.SUPABASE_SERVICE_ROLE_KEY,
  );
}

function unwrap<T>(result: { data: T; error: { message: string } | null }, what: string): T {
  if (result.error) throw new Error(`${what}: ${result.error.message}`);
  return result.data;
}

// ------------------------------------------------------------------ clients

export async function registerClient(args: {
  clientName: string;
  redirectUris: string[];
  wantsSecret: boolean;
}): Promise<{ clientId: string; clientSecret: string | null }> {
  const clientId = `mcp_${randomToken(16)}`;
  const clientSecret = args.wantsSecret ? randomToken(32) : null;
  unwrap(
    await admin()
      .from("oauth_clients")
      .insert({
        client_id: clientId,
        client_secret_hash: clientSecret ? hashToken(clientSecret) : null,
        client_name: args.clientName,
        redirect_uris: args.redirectUris,
      }),
    "registering client",
  );
  return { clientId, clientSecret };
}

export async function getClient(clientId: string): Promise<OAuthClient | null> {
  const data = unwrap(
    await admin()
      .from("oauth_clients")
      .select("client_id, client_secret_hash, client_name, redirect_uris")
      .eq("client_id", clientId)
      .maybeSingle(),
    "reading client",
  );
  return (data as OAuthClient | null) ?? null;
}

// -------------------------------------------------------------------- codes

/**
 * Store an authorization code. Only *who* approved is recorded: the grant's
 * session is minted fresh at exchange, never copied from the browser.
 */
export async function createAuthorizationCode(args: {
  clientId: string;
  userId: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  resource: string | null;
  scope: string | null;
}): Promise<string> {
  const code = randomToken(32);
  unwrap(
    await admin()
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
        expires_at: new Date(Date.now() + CODE_TTL_SECONDS * 1000).toISOString(),
      }),
    "storing authorization code",
  );
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
  const record = unwrap(
    await admin().from("oauth_codes").select("*").eq("code_hash", codeHash).maybeSingle(),
    "reading authorization code",
  ) as OAuthCode | null;
  if (!record) return null;
  if (record.consumed_at) return null;
  if (new Date(record.expires_at).getTime() < Date.now()) return null;

  const claimed = unwrap(
    await admin()
      .from("oauth_codes")
      .update({ consumed_at: new Date().toISOString() })
      .eq("code_hash", codeHash)
      .is("consumed_at", null)
      .select("code_hash"),
    "consuming authorization code",
  );
  if (!claimed || claimed.length === 0) return null;
  return record;
}

// ------------------------------------------------------------------- grants

const GRANT_COLUMNS =
  "id, client_id, user_id, resource, scope, session_access_token, session_refresh_token, session_expires_at, revoked_at";

export async function createGrant(args: {
  clientId: string;
  userId: string;
  resource: string | null;
  scope: string | null;
  session: SupabaseSession;
}): Promise<Grant> {
  const data = unwrap(
    await admin()
      .from("oauth_grants")
      .insert({
        client_id: args.clientId,
        user_id: args.userId,
        resource: args.resource,
        scope: args.scope,
        session_access_token: args.session.accessToken,
        session_refresh_token: args.session.refreshToken,
        session_expires_at: args.session.expiresAt.toISOString(),
      })
      .select(GRANT_COLUMNS)
      .single(),
    "creating grant",
  );
  return data as Grant;
}

export async function loadGrant(id: string): Promise<Grant | null> {
  const data = unwrap(
    await admin().from("oauth_grants").select(GRANT_COLUMNS).eq("id", id).maybeSingle(),
    "reading grant",
  );
  return (data as Grant | null) ?? null;
}

/**
 * Store a refreshed session, but only over the token that refresh consumed.
 *
 * The old write-back was conditional on the *new* value differing from the
 * stored one, which let a slow request replace a newer token with an older
 * one. Matching on the consumed token means the stored value only ever moves
 * forward.
 */
export async function saveGrantSession(
  id: string,
  consumed: string,
  next: SupabaseSession,
): Promise<boolean> {
  const data = unwrap(
    await admin()
      .from("oauth_grants")
      .update({
        session_access_token: next.accessToken,
        session_refresh_token: next.refreshToken,
        session_expires_at: next.expiresAt.toISOString(),
      })
      .eq("id", id)
      .eq("session_refresh_token", consumed)
      .is("revoked_at", null)
      .select("id"),
    "saving grant session",
  );
  return Boolean(data && data.length > 0);
}

export async function revokeGrant(id: string, reason: string): Promise<void> {
  unwrap(
    await admin()
      .from("oauth_grants")
      .update({ revoked_at: new Date().toISOString(), revoked_reason: reason })
      .eq("id", id)
      .is("revoked_at", null),
    "revoking grant",
  );
}

// ------------------------------------------------------------------- tokens

/**
 * Issue an access/refresh pair for a grant. With `parentId`, this is a
 * rotation: the new row is inserted *before* the parent is marked rotated, so
 * there is never a moment where the client's token is dead and its
 * replacement does not exist yet.
 */
export async function issueTokens(
  grant: Pick<Grant, "id" | "client_id" | "user_id" | "resource" | "scope">,
  parentId: string | null,
): Promise<IssuedTokens> {
  const accessToken = randomToken(32);
  const refreshToken = randomToken(32);
  unwrap(
    await admin()
      .from("oauth_tokens")
      .insert({
        access_token_hash: hashToken(accessToken),
        refresh_token_hash: hashToken(refreshToken),
        grant_id: grant.id,
        parent_id: parentId,
        client_id: grant.client_id,
        user_id: grant.user_id,
        resource: grant.resource,
        scope: grant.scope,
        expires_at: new Date(Date.now() + ACCESS_TOKEN_TTL_SECONDS * 1000).toISOString(),
      }),
    "issuing tokens",
  );

  if (parentId) {
    unwrap(
      await admin()
        .from("oauth_tokens")
        .update({ rotated_at: new Date().toISOString() })
        .eq("id", parentId)
        .is("rotated_at", null),
      "marking token rotated",
    );
  }
  return { accessToken, refreshToken, expiresIn: ACCESS_TOKEN_TTL_SECONDS };
}

/**
 * Look up a presented access token with its grant. Returns null when the
 * token is unknown, revoked or expired. A rotated token keeps working until it
 * expires, so requests already in flight at the moment of a refresh succeed.
 */
export async function findAccessToken(
  token: string,
): Promise<{ token: OAuthToken; grant: Grant | null } | null> {
  const data = unwrap(
    await admin()
      .from("oauth_tokens")
      .select(`*, grant:oauth_grants!oauth_tokens_grant_id_fkey(${GRANT_COLUMNS})`)
      .eq("access_token_hash", hashToken(token))
      .maybeSingle(),
    "reading access token",
  ) as (OAuthToken & { grant: Grant | null }) | null;
  if (!data || data.revoked_at) return null;
  if (new Date(data.expires_at).getTime() < Date.now()) return null;
  const { grant, ...row } = data;
  return { token: row, grant };
}

/**
 * Record that the client has this token pair, which is what retires the pair
 * it replaced (see refresh-policy.ts). Written once per token.
 */
export async function markTokenUsed(token: OAuthToken): Promise<void> {
  if (token.used_at) return;
  unwrap(
    await admin()
      .from("oauth_tokens")
      .update({ used_at: new Date().toISOString() })
      .eq("id", token.id)
      .is("used_at", null),
    "marking token used",
  );
}

/** Exchange a refresh token for a new pair, under the rotation policy. */
export async function exchangeRefreshToken(
  refreshToken: string,
  clientId: string,
): Promise<{ ok: true; tokens: IssuedTokens; scope: string | null } | { ok: false; reason: string }> {
  const token = unwrap(
    await admin()
      .from("oauth_tokens")
      .select("*")
      .eq("refresh_token_hash", hashToken(refreshToken))
      .maybeSingle(),
    "reading refresh token",
  ) as OAuthToken | null;

  const grant = token?.grant_id ? await loadGrant(token.grant_id) : null;

  let successorUsed = false;
  if (token?.rotated_at) {
    const used = unwrap(
      await admin()
        .from("oauth_tokens")
        .select("id")
        .eq("parent_id", token.id)
        .or("used_at.not.is.null,rotated_at.not.is.null")
        .limit(1),
      "checking successors",
    );
    successorUsed = Boolean(used && used.length > 0);
  }

  const refusal = refreshRefusal({ token, clientId, grant, successorUsed });
  if (refusal || !token || !grant) return { ok: false, reason: refusal ?? "Refresh token is invalid" };

  // Presenting this refresh token proves the client received this pair, which
  // retires the pair before it.
  await markTokenUsed(token);
  const tokens = await issueTokens(grant, token.id);
  return { ok: true, tokens, scope: grant.scope };
}
