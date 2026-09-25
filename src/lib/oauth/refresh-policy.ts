/**
 * When may a refresh token be exchanged?
 *
 * Refresh tokens rotate: every exchange issues a new pair. The old code
 * revoked the presented token *before* inserting its successor, so any
 * failure in between (a timeout, a dropped connection, a database error)
 * left the client holding a revoked token and nothing else. One grant in
 * production ended exactly that way.
 *
 * Here a rotated token stays exchangeable until the client proves it received
 * the successor, by using the successor's access token or refresh token. A
 * client that lost the response can simply retry. Once the successor has been
 * used, the old token is refused, which is what rotation is for.
 */

export type RefreshTokenRow = {
  client_id: string;
  grant_id: string | null;
  revoked_at: string | null;
  rotated_at: string | null;
};

export type GrantState = { revoked_at: string | null };

/** Why this refresh token must be refused, or null if it may be exchanged. */
export function refreshRefusal(args: {
  token: RefreshTokenRow | null;
  clientId: string;
  grant: GrantState | null;
  /** Whether any token issued in exchange for this one has been used. */
  successorUsed: boolean;
}): string | null {
  const { token, clientId, grant, successorUsed } = args;
  if (!token) return "Refresh token is invalid";
  if (token.client_id !== clientId) return "Refresh token was issued to a different client";
  if (token.revoked_at) return "Refresh token has been revoked";
  if (!token.grant_id || !grant) {
    // Issued before grants had their own session: those shared the browser's
    // session and cannot be trusted to stay alive. Re-authorizing fixes it.
    return "This connection predates a session fix; reconnect to continue";
  }
  if (grant.revoked_at) {
    return "The workspace session behind this connection has ended; reconnect to continue";
  }
  if (token.rotated_at && successorUsed) {
    return "Refresh token was superseded by a newer one";
  }
  return null;
}
