/**
 * The canonical origin this deployment issues OAuth identity for.
 *
 * Every OAuth document — the protected-resource metadata, the authorization
 * server metadata, the audience a token is bound to — has to name one stable
 * origin. Deriving it from the incoming request works until a request arrives
 * on a different hostname: Vercel gives every deployment its own preview URL,
 * so a grant obtained through one would be audience-bound to a hostname that
 * disappears on the next deploy, and the connector would need re-authorizing.
 *
 * Preference order:
 *   1. OAUTH_ISSUER_ORIGIN — set it to pin the origin explicitly.
 *   2. VERCEL_PROJECT_PRODUCTION_URL — the project's stable production domain,
 *      which Vercel sets on every deployment including previews.
 *   3. The request's own origin — correct for local development, where
 *      neither variable is set.
 */
export function canonicalOrigin(requestOrigin: string): string {
  const configured = process.env.OAUTH_ISSUER_ORIGIN?.trim();
  if (configured) return normalizeOrigin(configured);

  const production = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (production) return normalizeOrigin(production);

  return normalizeOrigin(requestOrigin);
}

/** Accepts a bare host or a full URL; always returns scheme://host with no trailing slash. */
function normalizeOrigin(value: string): string {
  const withScheme = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  try {
    const url = new URL(withScheme);
    return `${url.protocol.toLowerCase()}//${url.host.toLowerCase()}`;
  } catch {
    return value.replace(/\/+$/, "");
  }
}
