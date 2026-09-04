/**
 * Opening the workspace session behind an MCP access token.
 *
 * Supabase rotates a refresh token every time it is used and revokes the old
 * one after a short reuse window. The remote MCP endpoint refreshes on every
 * request, so the rotated value has to be written back — otherwise the stored
 * token is dead within minutes and the connector drops to needs-auth.
 *
 * The orchestration lives here, separate from the route, so the rotation
 * behaviour can be tested against a fake that rotates and rejects reuse the
 * way the real service does.
 */

export type OpenedSession<Client> = {
  client: Client;
  /** The refresh token to store for next time; rotated on nearly every call. */
  refreshToken: string;
};

export type StoredToken = {
  id: string;
  supabase_refresh_token: string;
};

/**
 * Refresh the user's session and persist the rotated token.
 *
 * Returns null only when the refresh genuinely failed — the caller turns that
 * into a 401 with the discovery challenge, which is correct for an expired
 * grant.
 *
 * The write-back is conditional and best-effort: two concurrent MCP requests
 * can both refresh, and Supabase's reuse window covers that. Losing the race
 * must not fail the request that is otherwise fine.
 */
export async function openUserSession<Client>(
  stored: StoredToken,
  refresh: (refreshToken: string) => Promise<OpenedSession<Client> | null>,
  persist: (tokenId: string, refreshToken: string) => Promise<unknown>,
): Promise<Client | null> {
  const opened = await refresh(stored.supabase_refresh_token);
  if (!opened) return null;

  const rotated = opened.refreshToken;
  if (rotated && rotated !== stored.supabase_refresh_token) {
    try {
      await persist(stored.id, rotated);
    } catch {
      // A concurrent request already stored its own rotation. The session in
      // hand is valid, so serve the request rather than failing it.
    }
  }

  return opened.client;
}
