import { describe, expect, it, vi } from "vitest";
import { openUserSession, type OpenedSession } from "./session";

/**
 * A stand-in for Supabase auth: every refresh returns a new token and revokes
 * the one that was used, which is what makes the discarded rotation fatal in
 * production rather than merely untidy.
 */
function fakeSupabase() {
  let counter = 0;
  const live = new Set<string>(["rt-initial"]);
  const used: string[] = [];

  return {
    used,
    isLive: (token: string) => live.has(token),
    async refresh(refreshToken: string): Promise<OpenedSession<string> | null> {
      used.push(refreshToken);
      if (!live.has(refreshToken)) return null; // reused or revoked
      live.delete(refreshToken);
      const next = `rt-${++counter}`;
      live.add(next);
      return { client: `client-${counter}`, refreshToken: next };
    },
  };
}

/** A stand-in for oauth_tokens holding one row. */
function fakeStore(initial: string) {
  const row = { id: "token-1", supabase_refresh_token: initial };
  const writes: string[] = [];
  return {
    row,
    writes,
    async persist(tokenId: string, refreshToken: string) {
      expect(tokenId).toBe("token-1");
      writes.push(refreshToken);
      row.supabase_refresh_token = refreshToken;
    },
  };
}

describe("openUserSession", () => {
  it("keeps working on a later request because the rotation was stored", async () => {
    // the regression: without a write-back the second call reuses a revoked
    // token and 401s a few minutes after authorization
    const supabase = fakeSupabase();
    const store = fakeStore("rt-initial");

    const first = await openUserSession(store.row, supabase.refresh, store.persist);
    expect(first).toBe("client-1");

    const second = await openUserSession(store.row, supabase.refresh, store.persist);
    expect(second).toBe("client-2");

    const third = await openUserSession(store.row, supabase.refresh, store.persist);
    expect(third).toBe("client-3");

    // each request used the token the previous one stored, never a stale one
    expect(supabase.used).toEqual(["rt-initial", "rt-1", "rt-2"]);
    expect(store.writes).toEqual(["rt-1", "rt-2", "rt-3"]);
  });

  it("fails the way the old code did when the rotation is discarded", async () => {
    // proves the fake really does revoke on use, so the test above is meaningful
    const supabase = fakeSupabase();
    const store = fakeStore("rt-initial");
    const discard = async () => {};

    expect(await openUserSession(store.row, supabase.refresh, discard)).toBe("client-1");
    expect(await openUserSession(store.row, supabase.refresh, discard)).toBeNull();
  });

  it("persists only when the token actually changed", async () => {
    const persist = vi.fn();
    const unchanged = async (refreshToken: string) => ({
      client: "client",
      refreshToken,
    });

    const result = await openUserSession(
      { id: "token-1", supabase_refresh_token: "rt-same" },
      unchanged,
      persist,
    );
    expect(result).toBe("client");
    expect(persist).not.toHaveBeenCalled();
  });

  it("serves the request when a concurrent write-back wins the race", async () => {
    const supabase = fakeSupabase();
    const losing = vi.fn().mockRejectedValue(new Error("row changed by another request"));

    const client = await openUserSession(
      { id: "token-1", supabase_refresh_token: "rt-initial" },
      supabase.refresh,
      losing,
    );

    expect(losing).toHaveBeenCalled();
    expect(client).toBe("client-1"); // the session in hand is still valid
  });

  it("returns null when the refresh genuinely fails, so the route can 401", async () => {
    const client = await openUserSession(
      { id: "token-1", supabase_refresh_token: "rt-dead" },
      async () => null,
      async () => {
        throw new Error("must not persist after a failed refresh");
      },
    );
    expect(client).toBeNull();
  });

  it("does not persist an empty rotation", async () => {
    const persist = vi.fn();
    await openUserSession(
      { id: "token-1", supabase_refresh_token: "rt-initial" },
      async () => ({ client: "client", refreshToken: "" }),
      persist,
    );
    expect(persist).not.toHaveBeenCalled();
  });
});
