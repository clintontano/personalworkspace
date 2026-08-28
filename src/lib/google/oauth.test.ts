import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildAuthUrl, googleConfigured, redirectUri, SCOPES } from "./oauth";

const ORIGINAL = { ...process.env };

beforeEach(() => {
  process.env.GOOGLE_CLIENT_ID = "test-client-id.apps.googleusercontent.com";
  process.env.GOOGLE_CLIENT_SECRET = "test-secret";
});

afterEach(() => {
  process.env = { ...ORIGINAL };
});

describe("googleConfigured", () => {
  it("is true only when both credentials are present", () => {
    expect(googleConfigured()).toBe(true);
    delete process.env.GOOGLE_CLIENT_SECRET;
    expect(googleConfigured()).toBe(false);
  });
});

describe("redirectUri", () => {
  it("matches the callback route exactly (Google requires a byte-for-byte match)", () => {
    expect(redirectUri("http://localhost:3000")).toBe(
      "http://localhost:3000/api/google/callback",
    );
  });
});

describe("buildAuthUrl", () => {
  const params = (kind: keyof typeof SCOPES) =>
    new URL(buildAuthUrl("http://localhost:3000", kind)).searchParams;

  it("targets Google's authorization endpoint", () => {
    const url = new URL(buildAuthUrl("http://localhost:3000", "calendar"));
    expect(url.host).toBe("accounts.google.com");
    expect(url.pathname).toBe("/o/oauth2/v2/auth");
  });

  it("requests the calendar scope and carries the kind as state", () => {
    const p = params("calendar");
    expect(p.get("scope")).toBe(`openid email ${SCOPES.calendar}`);
    expect(p.get("state")).toBe("calendar");
  });

  it("requests read-only Gmail access, never write access", () => {
    const p = params("gmail");
    expect(p.get("scope")).toContain("gmail.readonly");
    expect(p.get("scope")).not.toContain("gmail.modify");
    expect(p.get("scope")).not.toContain("gmail.send");
  });

  it("asks for offline access with consent, so a refresh token is issued", () => {
    const p = params("calendar");
    expect(p.get("access_type")).toBe("offline");
    expect(p.get("prompt")).toBe("consent");
    expect(p.get("response_type")).toBe("code");
  });

  it("sends the configured client id and matching redirect uri", () => {
    const p = params("calendar");
    expect(p.get("client_id")).toBe(process.env.GOOGLE_CLIENT_ID);
    expect(p.get("redirect_uri")).toBe("http://localhost:3000/api/google/callback");
  });
});
