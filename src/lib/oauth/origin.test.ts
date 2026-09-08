import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { canonicalOrigin } from "./origin";

const ORIGINAL = { ...process.env };

beforeEach(() => {
  delete process.env.OAUTH_ISSUER_ORIGIN;
  delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
});

afterEach(() => {
  process.env = { ...ORIGINAL };
});

describe("canonicalOrigin", () => {
  it("falls back to the request origin for local development", () => {
    expect(canonicalOrigin("http://localhost:3000")).toBe("http://localhost:3000");
  });

  it("prefers the pinned origin over the request", () => {
    process.env.OAUTH_ISSUER_ORIGIN = "https://app.example.com";
    expect(canonicalOrigin("https://preview-xyz.vercel.app")).toBe("https://app.example.com");
  });

  it("uses the production domain on a preview deploy, so grants stay portable", () => {
    // Vercel sets this on previews too, which is the point: a token minted
    // from a preview must not be bound to a hostname that disappears
    process.env.VERCEL_PROJECT_PRODUCTION_URL = "personalworkspace-beta.vercel.app";
    expect(canonicalOrigin("https://personalworkspace-abc123.vercel.app")).toBe(
      "https://personalworkspace-beta.vercel.app",
    );
  });

  it("lets an explicit pin win over the Vercel default", () => {
    process.env.OAUTH_ISSUER_ORIGIN = "https://notes.example.com";
    process.env.VERCEL_PROJECT_PRODUCTION_URL = "personalworkspace-beta.vercel.app";
    expect(canonicalOrigin("https://whatever.vercel.app")).toBe("https://notes.example.com");
  });

  it("accepts a bare host and adds https", () => {
    process.env.OAUTH_ISSUER_ORIGIN = "app.example.com";
    expect(canonicalOrigin("http://localhost:3000")).toBe("https://app.example.com");
  });

  it("strips a path and trailing slash, and lowercases the host", () => {
    process.env.OAUTH_ISSUER_ORIGIN = "https://APP.Example.com/api/";
    expect(canonicalOrigin("http://localhost:3000")).toBe("https://app.example.com");
  });

  it("ignores a blank value rather than producing an empty origin", () => {
    process.env.OAUTH_ISSUER_ORIGIN = "   ";
    expect(canonicalOrigin("http://localhost:3000")).toBe("http://localhost:3000");
  });
});
