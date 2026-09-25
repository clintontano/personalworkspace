/**
 * Opening the workspace session behind an MCP grant.
 *
 * Each grant owns a Supabase session minted for it alone at token exchange
 * (see `mintUserSession`), stored once on the grant. This used to be the
 * browser's own session, copied at authorize time: browser and connector then
 * shared one refresh-token family, and as soon as the connector had rotated it
 * twice, the browser's next refresh looked like token theft to Supabase, which
 * revoked the family and killed the connector with it.
 *
 * Three rules keep the connector's own session alive:
 *
 * - Refresh only when the access token is about to expire, not on every
 *   request. The old code rotated on every call, which multiplied the chances
 *   of a collision.
 * - Write back with a compare-and-swap on the token that was consumed, so a
 *   slow request can never overwrite a newer token with an older one. Losing
 *   the swap is harmless: Supabase answers every holder of the parent token
 *   with the same active session.
 * - Tell "gone" apart from "try again". Supabase refusing the refresh ends the
 *   grant, so the client is told to re-authorize instead of looping on 401s. A
 *   network error or 5xx throws, so the route answers 503 and the client
 *   retries with its grant intact.
 *
 * Dependencies are injected so this can be tested against a fake that rotates
 * and detects reuse the way the real service does.
 */

/** Refresh when less than this remains on the Supabase access token. */
export const REFRESH_MARGIN_MS = 5 * 60 * 1000;

export type GrantRecord = {
  id: string;
  user_id: string;
  session_access_token: string;
  session_refresh_token: string;
  session_expires_at: string;
  revoked_at: string | null;
};

export type SupabaseSession = {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
};

/** A definitive answer from Supabase. Transient failures throw instead. */
export type RefreshOutcome =
  | { ok: true; session: SupabaseSession }
  | { ok: false; reason: string };

export type GrantSessionDeps = {
  /** Re-read a grant. Throws on a database error. */
  loadGrant(id: string): Promise<GrantRecord | null>;
  /** Refresh at Supabase. Throws `TransientAuthError` when worth retrying. */
  refresh(refreshToken: string): Promise<RefreshOutcome>;
  /**
   * Store a refreshed session only if the grant still holds `consumed`.
   * Returns whether this call wrote. Throws on a database error.
   */
  saveSession(id: string, consumed: string, next: SupabaseSession): Promise<boolean>;
  /** Mark the grant dead so its refresh tokens stop working too. */
  revokeGrant(id: string, reason: string): Promise<void>;
  now(): number;
};

export type OpenedGrant =
  | { ok: true; accessToken: string; userId: string }
  | { ok: false; reason: string };

/** Worth retrying: the grant is fine, Supabase or the network was not. */
export class TransientAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TransientAuthError";
  }
}

export function isFresh(grant: GrantRecord, now: number): boolean {
  return new Date(grant.session_expires_at).getTime() - now > REFRESH_MARGIN_MS;
}

export async function openGrantSession(
  grant: GrantRecord,
  deps: GrantSessionDeps,
): Promise<OpenedGrant> {
  if (grant.revoked_at) return { ok: false, reason: "grant revoked" };
  if (isFresh(grant, deps.now())) {
    return { ok: true, accessToken: grant.session_access_token, userId: grant.user_id };
  }

  const outcome = await deps.refresh(grant.session_refresh_token);

  if (outcome.ok) {
    try {
      await deps.saveSession(grant.id, grant.session_refresh_token, outcome.session);
    } catch {
      // The session in hand is valid, so serve the request. The stored token
      // is now the direct parent of the active one, which Supabase still
      // accepts, so the next refresh heals the missed write.
    }
    return { ok: true, accessToken: outcome.session.accessToken, userId: grant.user_id };
  }

  // Refused. Before declaring the grant dead, check whether a concurrent
  // request already moved it on to a fresh session.
  const latest = await deps.loadGrant(grant.id);
  if (
    latest &&
    !latest.revoked_at &&
    latest.session_refresh_token !== grant.session_refresh_token &&
    isFresh(latest, deps.now())
  ) {
    return { ok: true, accessToken: latest.session_access_token, userId: latest.user_id };
  }

  await deps.revokeGrant(grant.id, outcome.reason);
  return { ok: false, reason: outcome.reason };
}
