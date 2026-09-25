import { describe, expect, it } from "vitest";
import { refreshRefusal, type RefreshTokenRow } from "./refresh-policy";

const live: RefreshTokenRow = {
  client_id: "client-1",
  grant_id: "grant-1",
  revoked_at: null,
  rotated_at: null,
};
const grant = { revoked_at: null };

function refusal(token: Partial<RefreshTokenRow> | null, extra: { grantRevoked?: boolean; successorUsed?: boolean; clientId?: string } = {}) {
  return refreshRefusal({
    token: token === null ? null : { ...live, ...token },
    clientId: extra.clientId ?? "client-1",
    grant: extra.grantRevoked ? { revoked_at: "then" } : grant,
    successorUsed: extra.successorUsed ?? false,
  });
}

describe("refreshRefusal", () => {
  it("allows a live token that has never been exchanged", () => {
    expect(refusal({})).toBeNull();
  });

  it("allows a rotated token again while its successor is unused", () => {
    // the client lost the refresh response; revoking here stranded it
    expect(refusal({ rotated_at: "earlier" }, { successorUsed: false })).toBeNull();
  });

  it("refuses a rotated token once its successor has been used", () => {
    expect(refusal({ rotated_at: "earlier" }, { successorUsed: true })).toMatch(/superseded/);
  });

  it("refuses unknown, revoked and other clients' tokens", () => {
    expect(refusal(null)).toMatch(/invalid/);
    expect(refusal({ revoked_at: "then" })).toMatch(/revoked/);
    expect(refusal({}, { clientId: "someone-else" })).toMatch(/different client/);
  });

  it("refuses tokens from before grants had their own session, asking for a reconnect", () => {
    expect(refusal({ grant_id: null })).toMatch(/reconnect/);
  });

  it("refuses once the grant's session has ended, asking for a reconnect", () => {
    // refreshing a grant whose session is dead only buys the client another
    // 401 — this is what made Claude loop six times before giving up
    expect(refusal({}, { grantRevoked: true })).toMatch(/reconnect/);
  });
});
