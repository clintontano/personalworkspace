import { createHash, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  base64url,
  canonicalResource,
  hashToken,
  isAllowedRedirectUri,
  isRegisteredRedirect,
  randomToken,
  resourceMatches,
  safeEqual,
  verifyPkce,
} from "./crypto";

/** Build a valid verifier/challenge pair the way a client would. */
function pkcePair() {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

describe("base64url", () => {
  it("is URL-safe and unpadded", () => {
    const encoded = base64url(Buffer.from([251, 255, 190, 255]));
    expect(encoded).not.toMatch(/[+/=]/);
  });
});

describe("randomToken", () => {
  it("produces distinct high-entropy values", () => {
    const tokens = new Set(Array.from({ length: 50 }, () => randomToken()));
    expect(tokens.size).toBe(50);
    expect([...tokens][0].length).toBeGreaterThanOrEqual(40);
  });
});

describe("hashToken", () => {
  it("is stable and does not reveal the token", () => {
    const token = randomToken();
    expect(hashToken(token)).toBe(hashToken(token));
    expect(hashToken(token)).not.toContain(token);
  });

  it("differs for different tokens", () => {
    expect(hashToken("a")).not.toBe(hashToken("b"));
  });
});

describe("safeEqual", () => {
  it("matches identical strings and rejects others", () => {
    expect(safeEqual("secret", "secret")).toBe(true);
    expect(safeEqual("secret", "secrez")).toBe(false);
  });

  it("handles different lengths without throwing", () => {
    expect(safeEqual("short", "much longer value")).toBe(false);
  });
});

describe("verifyPkce", () => {
  it("accepts a correct S256 pair", () => {
    const { verifier, challenge } = pkcePair();
    expect(verifyPkce(verifier, challenge)).toBe(true);
  });

  it("rejects a mismatched verifier", () => {
    const { challenge } = pkcePair();
    const other = pkcePair().verifier;
    expect(verifyPkce(other, challenge)).toBe(false);
  });

  it("refuses the plain method, which OAuth 2.1 drops", () => {
    const { verifier } = pkcePair();
    expect(verifyPkce(verifier, verifier, "plain")).toBe(false);
  });

  it("rejects verifiers outside the legal length range", () => {
    const { challenge } = pkcePair();
    expect(verifyPkce("tooshort", challenge)).toBe(false);
    expect(verifyPkce("a".repeat(129), challenge)).toBe(false);
  });

  it("rejects verifiers with illegal characters", () => {
    expect(verifyPkce("!".repeat(50), "anything")).toBe(false);
  });

  it("rejects empty input", () => {
    expect(verifyPkce("", "")).toBe(false);
  });
});

describe("isRegisteredRedirect", () => {
  const registered = ["https://claude.ai/api/mcp/auth_callback"];

  it("requires an exact match", () => {
    expect(isRegisteredRedirect("https://claude.ai/api/mcp/auth_callback", registered)).toBe(true);
  });

  it("rejects prefix tricks that would leak the code", () => {
    expect(
      isRegisteredRedirect("https://claude.ai/api/mcp/auth_callback/../evil", registered),
    ).toBe(false);
    expect(isRegisteredRedirect("https://claude.ai.evil.com/cb", registered)).toBe(false);
    expect(isRegisteredRedirect("https://claude.ai/api/mcp/auth_callback?x=1", registered)).toBe(
      false,
    );
  });
});

describe("isAllowedRedirectUri", () => {
  it("allows https anywhere", () => {
    expect(isAllowedRedirectUri("https://claude.ai/callback")).toBe(true);
  });

  it("allows http only on loopback", () => {
    expect(isAllowedRedirectUri("http://localhost:3000/cb")).toBe(true);
    expect(isAllowedRedirectUri("http://127.0.0.1:8080/cb")).toBe(true);
    expect(isAllowedRedirectUri("http://example.com/cb")).toBe(false);
  });

  it("rejects other schemes, fragments and junk", () => {
    expect(isAllowedRedirectUri("javascript:alert(1)")).toBe(false);
    expect(isAllowedRedirectUri("https://claude.ai/cb#frag")).toBe(false);
    expect(isAllowedRedirectUri("not a url")).toBe(false);
  });
});

describe("canonicalResource", () => {
  it("lowercases scheme and host and drops a trailing slash", () => {
    expect(canonicalResource("HTTPS://Example.COM/api/mcp/")).toBe(
      "https://example.com/api/mcp",
    );
  });

  it("returns null for junk", () => {
    expect(canonicalResource("nope")).toBeNull();
  });
});

describe("resourceMatches", () => {
  it("accepts equivalent forms of the same resource", () => {
    expect(resourceMatches("https://app.example.com/api/mcp", "https://app.example.com/api/mcp/")).toBe(true);
    expect(resourceMatches("https://APP.example.com/api/mcp", "https://app.example.com/api/mcp")).toBe(true);
  });

  it("rejects a token minted for a different host", () => {
    expect(resourceMatches("https://evil.example.com/api/mcp", "https://app.example.com/api/mcp")).toBe(false);
  });

  it("rejects a different path on the same host", () => {
    expect(resourceMatches("https://app.example.com/other", "https://app.example.com/api/mcp")).toBe(false);
  });

  it("allows a token stored before audience binding existed", () => {
    expect(resourceMatches(null, "https://app.example.com/api/mcp")).toBe(true);
  });
});
