import { describe, expect, it, vi } from "vitest";
import {
  openGrantSession,
  REFRESH_MARGIN_MS,
  TransientAuthError,
  type GrantRecord,
  type GrantSessionDeps,
  type RefreshOutcome,
  type SupabaseSession,
} from "./grant-session";

const HOUR = 60 * 60 * 1000;
const REUSE_INTERVAL_MS = 10_000;

/**
 * Supabase auth as it behaved on the real project (reproduced against it
 * before this was written):
 *
 * - A refresh rotates: the presented token is revoked and a child issued.
 * - Presenting the *direct parent* of the active token returns the active one
 *   again, at any time: that client just lost a response.
 * - Presenting an older token inside the reuse interval issues a new token.
 * - Presenting an older token after it is treated as theft
 *   (refresh_token_already_used) and the whole family is revoked.
 */
class FakeSupabaseAuth {
  now = 0;
  refreshCalls = 0;
  private counter = 0;
  private tokens = new Map<
    string,
    { family: string; parent: string | null; revokedAt: number | null }
  >();
  private families = new Map<string, { revoked: boolean; active: string }>();

  signIn(): SupabaseSession {
    const family = `family-${++this.counter}`;
    const token = this.mint(family, null);
    this.families.set(family, { revoked: false, active: token });
    return this.session(token);
  }

  refresh = async (token: string): Promise<RefreshOutcome> => {
    this.refreshCalls += 1;
    const record = this.tokens.get(token);
    if (!record) return { ok: false, reason: "refresh_token_not_found" };
    const family = this.families.get(record.family)!;
    if (family.revoked) return { ok: false, reason: "refresh_token_already_used" };

    if (record.revokedAt === null) return this.rotate(record.family, token);

    const active = this.tokens.get(family.active)!;
    if (active.parent === token) return { ok: true, session: this.session(family.active) };
    if (this.now - record.revokedAt <= REUSE_INTERVAL_MS) return this.rotate(record.family, token);

    family.revoked = true;
    return { ok: false, reason: "refresh_token_already_used" };
  };

  private rotate(familyId: string, token: string): RefreshOutcome {
    this.tokens.get(token)!.revokedAt = this.now;
    const child = this.mint(familyId, token);
    this.families.get(familyId)!.active = child;
    return { ok: true, session: this.session(child) };
  }

  private mint(family: string, parent: string | null) {
    const token = `rt-${++this.counter}`;
    this.tokens.set(token, { family, parent, revokedAt: null });
    return token;
  }

  private session(refreshToken: string): SupabaseSession {
    return {
      accessToken: `at(${refreshToken})`,
      refreshToken,
      expiresAt: new Date(this.now + HOUR),
    };
  }
}

/** oauth_grants holding one row, with the same compare-and-swap as the real store. */
function fakeGrantStore(initial: SupabaseSession) {
  const row: GrantRecord = {
    id: "grant-1",
    user_id: "user-1",
    session_access_token: initial.accessToken,
    session_refresh_token: initial.refreshToken,
    session_expires_at: initial.expiresAt.toISOString(),
    revoked_at: null,
  };
  const writes: string[] = [];
  let revokedReason: string | null = null;
  return {
    row,
    writes,
    revokedReason: () => revokedReason,
    /** What findAccessToken hands a request: the row as it is right now. */
    read: (): GrantRecord => ({ ...row }),
    async loadGrant() {
      return { ...row };
    },
    async saveSession(_id: string, consumed: string, next: SupabaseSession) {
      if (row.session_refresh_token !== consumed || row.revoked_at) return false;
      row.session_access_token = next.accessToken;
      row.session_refresh_token = next.refreshToken;
      row.session_expires_at = next.expiresAt.toISOString();
      writes.push(next.refreshToken);
      return true;
    },
    async revokeGrant(_id: string, reason: string) {
      row.revoked_at = "revoked";
      revokedReason = reason;
    },
  };
}

type Store = ReturnType<typeof fakeGrantStore>;

function deps(store: Store, auth: FakeSupabaseAuth, overrides: Partial<GrantSessionDeps> = {}) {
  return {
    loadGrant: store.loadGrant,
    refresh: auth.refresh,
    saveSession: store.saveSession,
    revokeGrant: store.revokeGrant,
    now: () => auth.now,
    ...overrides,
  } satisfies GrantSessionDeps;
}

/** One MCP request: read the grant, open its session. */
function request(store: Store, auth: FakeSupabaseAuth, overrides: Partial<GrantSessionDeps> = {}) {
  return openGrantSession(store.read(), deps(store, auth, overrides));
}

describe("openGrantSession", () => {
  it("serves from the stored session without refreshing while it is fresh", async () => {
    const auth = new FakeSupabaseAuth();
    const store = fakeGrantStore(auth.signIn());

    const opened = await request(store, auth);
    expect(opened).toEqual({ ok: true, accessToken: store.row.session_access_token, userId: "user-1" });
    expect(auth.refreshCalls).toBe(0);
  });

  it("refreshes near expiry and stores the rotation", async () => {
    const auth = new FakeSupabaseAuth();
    const store = fakeGrantStore(auth.signIn());
    const before = store.row.session_refresh_token;

    auth.now += HOUR - REFRESH_MARGIN_MS + 1;
    const opened = await request(store, auth);

    expect(opened.ok).toBe(true);
    expect(auth.refreshCalls).toBe(1);
    expect(store.row.session_refresh_token).not.toBe(before);
    expect(opened.ok && opened.accessToken).toBe(store.row.session_access_token);
  });

  it("rotates about once an hour under steady use, not once per request", async () => {
    // the old code refreshed on every request; each rotation is another
    // chance to collide with anything else holding the family
    const auth = new FakeSupabaseAuth();
    const store = fakeGrantStore(auth.signIn());

    for (let minute = 0; minute < 180; minute += 1) {
      auth.now = minute * 60_000;
      expect((await request(store, auth)).ok).toBe(true);
    }
    expect(auth.refreshCalls).toBe(3);
  });

  it("survives the browser tripping reuse detection on its own session", async () => {
    // the fix: the grant's session is minted for it alone
    const auth = new FakeSupabaseAuth();
    const browser = auth.signIn();
    const store = fakeGrantStore(auth.signIn());

    let browserToken = browser.refreshToken;
    for (let i = 0; i < 2; i += 1) {
      const next = await auth.refresh(browserToken);
      if (next.ok) browserToken = next.session.refreshToken;
    }
    auth.now += HOUR;
    expect((await auth.refresh(browser.refreshToken)).ok).toBe(false); // theft detected

    for (let hour = 0; hour < 6; hour += 1) {
      auth.now += HOUR;
      expect((await request(store, auth)).ok).toBe(true);
    }
  });

  it("documents the incident: a grant sharing the browser's family dies with it", async () => {
    // what /api/oauth/authorize used to do: copy the browser's session
    const auth = new FakeSupabaseAuth();
    const browser = auth.signIn();
    const store = fakeGrantStore(browser);

    auth.now += HOUR;
    await request(store, auth);
    auth.now += HOUR;
    await request(store, auth); // the connector is now two rotations ahead

    auth.now += 60_000;
    expect((await auth.refresh(browser.refreshToken)).ok).toBe(false);

    auth.now += HOUR;
    expect(await request(store, auth)).toEqual({ ok: false, reason: "refresh_token_already_used" });
  });

  it("lets a burst of concurrent requests at expiry all succeed and leaves a working token", async () => {
    const auth = new FakeSupabaseAuth();
    const store = fakeGrantStore(auth.signIn());
    auth.now += HOUR;

    const snapshots = Array.from({ length: 5 }, () => store.read());
    const results = await Promise.all(snapshots.map((grant) => openGrantSession(grant, deps(store, auth))));

    expect(results.every((r) => r.ok)).toBe(true);
    expect(store.writes).toHaveLength(1); // one winner; the others were handed the same session

    for (let hour = 0; hour < 4; hour += 1) {
      auth.now += HOUR;
      expect((await request(store, auth)).ok).toBe(true);
    }
  });

  it("never lets a slow request overwrite a newer token with an older one", async () => {
    // The old write-back only checked that the new value differed from the
    // stored one, so a request that finished late put back whatever it had.
    // One generation stale is forgiven (it is the active token's parent); two
    // or more trips reuse detection on the next refresh and ends the grant.
    const auth = new FakeSupabaseAuth();
    const store = fakeGrantStore(auth.signIn());
    auth.now += HOUR;

    let releaseSlow!: () => void;
    const slowSave: GrantSessionDeps["saveSession"] = async (...args) => {
      await new Promise<void>((resolve) => (releaseSlow = resolve));
      return store.saveSession(...args);
    };

    const slow = openGrantSession(store.read(), deps(store, auth, { saveSession: slowSave }));
    expect((await request(store, auth)).ok).toBe(true); // generation 2 stored

    for (let i = 0; i < 2; i += 1) {
      auth.now += HOUR;
      expect((await request(store, auth)).ok).toBe(true); // generations 3 and 4
    }
    const newest = store.row.session_refresh_token;

    releaseSlow(); // finally writes back generation 2, now two behind the active token
    expect((await slow).ok).toBe(true);
    expect(store.row.session_refresh_token).toBe(newest);

    auth.now += HOUR;
    expect((await request(store, auth)).ok).toBe(true);
  });

  it("serves the request when the write-back fails, and the next refresh heals it", async () => {
    const auth = new FakeSupabaseAuth();
    const store = fakeGrantStore(auth.signIn());
    auth.now += HOUR;

    const failing = vi.fn().mockRejectedValue(new Error("database unavailable"));
    expect((await request(store, auth, { saveSession: failing })).ok).toBe(true);

    // the stored token is now the parent of the active one, which Supabase
    // answers with the active session rather than treating as theft
    auth.now += 10 * 60_000;
    expect((await request(store, auth)).ok).toBe(true);
    auth.now += 2 * HOUR;
    expect((await request(store, auth)).ok).toBe(true);
  });

  it("revokes the grant when Supabase refuses, so the client re-authorizes", async () => {
    const auth = new FakeSupabaseAuth();
    const store = fakeGrantStore(auth.signIn());
    auth.now += HOUR;

    const refused = async (): Promise<RefreshOutcome> => ({ ok: false, reason: "session_not_found" });
    expect(await request(store, auth, { refresh: refused })).toEqual({
      ok: false,
      reason: "session_not_found",
    });
    expect(store.revokedReason()).toBe("session_not_found");
    expect(await request(store, auth)).toEqual({ ok: false, reason: "grant revoked" });
  });

  it("does not mistake a concurrent refresh for a dead session", async () => {
    const auth = new FakeSupabaseAuth();
    const store = fakeGrantStore(auth.signIn());
    auth.now += HOUR;
    const stale = store.read();

    expect((await request(store, auth)).ok).toBe(true); // someone else refreshed first
    const refused = async (): Promise<RefreshOutcome> => ({ ok: false, reason: "refresh_token_already_used" });
    const opened = await openGrantSession(stale, deps(store, auth, { refresh: refused }));

    expect(opened).toEqual({ ok: true, accessToken: store.row.session_access_token, userId: "user-1" });
    expect(store.row.revoked_at).toBeNull();
  });

  it("throws on a transient failure and leaves the grant untouched", async () => {
    const auth = new FakeSupabaseAuth();
    const store = fakeGrantStore(auth.signIn());
    auth.now += HOUR;
    const before = { ...store.row };

    const flaky = async (): Promise<RefreshOutcome> => {
      throw new TransientAuthError("fetch failed");
    };
    await expect(request(store, auth, { refresh: flaky })).rejects.toThrow(TransientAuthError);
    expect(store.row).toEqual(before);

    expect((await request(store, auth)).ok).toBe(true); // and it recovers once Supabase does
  });
});
