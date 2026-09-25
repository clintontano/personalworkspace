import "server-only";
import {
  createClient,
  isAuthRetryableFetchError,
  type Session,
  type SupabaseClient,
} from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import {
  TransientAuthError,
  type RefreshOutcome,
  type SupabaseSession,
} from "./grant-session";

/**
 * The Supabase sessions behind MCP grants.
 *
 * Each grant gets a session minted for it alone rather than a copy of the
 * browser's: two holders of one refresh-token family eventually trip
 * Supabase's reuse detection, which revokes the family for both.
 */

function env() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anonKey || !serviceKey) {
    throw new Error(
      "Remote MCP needs NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY",
    );
  }
  return { url, anonKey, serviceKey };
}

const noSession = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false };

function anon() {
  const { url, anonKey } = env();
  return createClient(url, anonKey, { auth: noSession });
}

function admin() {
  const { url, serviceKey } = env();
  return createClient(url, serviceKey, { auth: noSession });
}

/**
 * Worth retrying rather than ending the grant: the network, a rate limit, or
 * Supabase itself failed. Anything else from Supabase auth is its definitive
 * answer about this session.
 */
export function isTransientAuthFailure(error: unknown): boolean {
  if (isAuthRetryableFetchError(error)) return true;
  const status = (error as { status?: number } | null)?.status ?? 0;
  return status === 0 || status === 429 || status >= 500;
}

function failure(error: { code?: string; message: string }): RefreshOutcome {
  if (isTransientAuthFailure(error)) throw new TransientAuthError(error.message);
  return { ok: false, reason: error.code ?? error.message };
}

function toSession(session: Session): SupabaseSession {
  const expiresAt = session.expires_at
    ? session.expires_at * 1000
    : Date.now() + (session.expires_in ?? 3600) * 1000;
  return {
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    expiresAt: new Date(expiresAt),
  };
}

/**
 * Open a new session for a user who has already approved the connection.
 *
 * Uses the admin API to issue a sign-in token and redeems it at once, the
 * server-side equivalent of the user following a magic link. No email is
 * sent. The user proved who they are at the authorize step; this only gives
 * the grant a session of its own.
 */
export async function mintUserSession(userId: string): Promise<RefreshOutcome> {
  const { data: found, error: userError } = await admin().auth.admin.getUserById(userId);
  if (userError) return failure(userError);
  const email = found.user?.email;
  if (!email) return { ok: false, reason: "user has no email to sign in with" };

  const { data: link, error: linkError } = await admin().auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (linkError) return failure(linkError);

  const { data, error } = await anon().auth.verifyOtp({
    type: "magiclink",
    token_hash: link.properties.hashed_token,
  });
  if (error) return failure(error);
  if (!data.session || data.user?.id !== userId) {
    return { ok: false, reason: "sign-in did not produce a session for this user" };
  }
  return { ok: true, session: toSession(data.session) };
}

/** Exchange a grant's refresh token for a new session. */
export async function refreshSupabaseSession(refreshToken: string): Promise<RefreshOutcome> {
  const { data, error } = await anon().auth.refreshSession({ refresh_token: refreshToken });
  if (error) return failure(error);
  if (!data.session) return { ok: false, reason: "refresh returned no session" };
  return { ok: true, session: toSession(data.session) };
}

/**
 * A client acting as the user, so RLS applies exactly as in the app.
 *
 * It carries only the access token, never the refresh token. With no session
 * of its own, supabase-js has nothing it could refresh, so no library code can
 * rotate the grant's token behind the compare-and-swap in grant-session.ts.
 */
export function userScopedClient(accessToken: string): SupabaseClient<Database> {
  const { url, anonKey } = env();
  return createClient<Database>(url, anonKey, {
    auth: noSession,
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

/** Sign out a grant's session, for tearing down a test connection. */
export async function endSupabaseSession(accessToken: string): Promise<void> {
  await admin().auth.admin.signOut(accessToken, "local");
}
