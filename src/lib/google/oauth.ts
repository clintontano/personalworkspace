/** Server-only Google OAuth helpers (plain fetch, no SDK). */

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";

// Least privilege: we only read and write events, never calendar settings or
// ACLs, so calendar.events rather than the full calendar scope.
export const SCOPES = {
  calendar: "https://www.googleapis.com/auth/calendar.events",
  gmail: "https://www.googleapis.com/auth/gmail.readonly",
} as const;

export function googleConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

export function redirectUri(origin: string): string {
  return `${origin}/api/google/callback`;
}

export function buildAuthUrl(origin: string, kind: keyof typeof SCOPES): string {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: redirectUri(origin),
    response_type: "code",
    scope: `openid email ${SCOPES[kind]}`,
    access_type: "offline",
    prompt: "consent",
    // Carry previously granted scopes forward, so connecting Gmail does not
    // drop an existing Calendar grant (and vice versa).
    include_granted_scopes: "true",
    state: kind,
  });
  return `${AUTH_URL}?${params}`;
}

type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  id_token?: string;
  /** Space-separated scopes actually granted, which can be narrower than
   * those requested if the user leaves a permission unticked. */
  scope?: string;
};

/**
 * Did the user actually grant what we asked for? Google returns 200 with a
 * sign-in-only token when a permission checkbox is left unticked, and the
 * failure would otherwise surface much later as an opaque 403 from the API.
 */
export function hasRequiredScope(
  granted: string | undefined,
  kind: keyof typeof SCOPES,
): boolean {
  const scopes = (granted ?? "").split(/\s+/).filter(Boolean);
  return scopes.includes(SCOPES[kind]);
}

export async function exchangeCode(origin: string, code: string): Promise<TokenResponse> {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: redirectUri(origin),
      grant_type: "authorization_code",
      code,
    }),
  });
  if (!response.ok) throw new Error(`token exchange failed: ${await response.text()}`);
  return response.json();
}

export async function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });
  if (!response.ok) throw new Error(`token refresh failed: ${await response.text()}`);
  return response.json();
}

/** Email claim from an id_token (no verification needed: token came straight
 * from Google over TLS). */
export function emailFromIdToken(idToken: string | undefined): string {
  if (!idToken) return "";
  try {
    const payload = JSON.parse(
      Buffer.from(idToken.split(".")[1], "base64url").toString("utf8"),
    );
    return typeof payload.email === "string" ? payload.email : "";
  } catch {
    return "";
  }
}
