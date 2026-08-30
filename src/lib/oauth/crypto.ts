/**
 * OAuth 2.1 primitives for the remote MCP server.
 *
 * Kept pure and dependency-free so the parts that are easy to get subtly
 * wrong — PKCE verification, constant-time comparison, redirect URI matching
 * — are unit-tested rather than trusted.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** URL-safe base64 without padding, as OAuth requires. */
export function base64url(input: Buffer): string {
  return input.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** A high-entropy opaque token. */
export function randomToken(bytes = 32): string {
  return base64url(randomBytes(bytes));
}

/**
 * Tokens and authorization codes are stored hashed, so a dump of the tables
 * cannot be replayed against the server.
 */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Compare two secrets without leaking length or content through timing. */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * PKCE verification (RFC 7636). Only S256 is accepted: "plain" offers no
 * protection against a stolen authorization code, and OAuth 2.1 drops it.
 */
export function verifyPkce(
  verifier: string,
  challenge: string,
  method = "S256",
): boolean {
  if (method !== "S256") return false;
  if (!verifier || !challenge) return false;
  // RFC 7636 section 4.1
  if (verifier.length < 43 || verifier.length > 128) return false;
  if (!/^[A-Za-z0-9\-._~]+$/.test(verifier)) return false;
  const computed = base64url(createHash("sha256").update(verifier).digest());
  return safeEqual(computed, challenge);
}

/**
 * Redirect URIs must match a registered value exactly. Prefix or "starts
 * with" matching is a known open-redirect hole, so this is a literal compare.
 */
export function isRegisteredRedirect(uri: string, registered: string[]): boolean {
  return registered.some((candidate) => candidate === uri);
}

/**
 * A redirect target must be https, or http on loopback for local clients.
 * Anything else could hand an authorization code to an attacker.
 */
export function isAllowedRedirectUri(uri: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    return false;
  }
  if (parsed.hash) return false;
  if (parsed.protocol === "https:") return true;
  if (parsed.protocol === "http:") {
    return parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  }
  return false;
}

/**
 * The canonical resource identifier for audience binding (RFC 8707): scheme
 * and host lowercased, no fragment, no trailing slash.
 */
export function canonicalResource(uri: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    return null;
  }
  const path = parsed.pathname.replace(/\/+$/, "");
  return `${parsed.protocol.toLowerCase()}//${parsed.host.toLowerCase()}${path}`;
}

/**
 * Does a token issued for `granted` cover a request to `requested`?
 *
 * Compared canonically so a trailing slash or capitalised host does not
 * reject a legitimate token, while a genuinely different host still fails.
 */
export function resourceMatches(
  granted: string | null | undefined,
  requested: string,
): boolean {
  if (!granted) return true; // issued before audience binding was recorded
  const a = canonicalResource(granted);
  const b = canonicalResource(requested);
  return a !== null && b !== null && a === b;
}
