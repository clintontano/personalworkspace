/**
 * The remote connector's whole lifecycle, driven the way Claude drives it:
 * register, authorize, exchange, call a tool, let the access token expire,
 * refresh, call again. Then the situations that used to end a connection, each
 * of which now has to survive or fail cleanly.
 *
 * Time is forced forward through the service role (expiring rows directly)
 * rather than waited out, so the run takes under a minute. Nothing it prints is
 * a credential. It creates one OAuth client and deletes it, grants and tokens
 * included, when it finishes.
 *
 * Needs .env.local and the oauth_grants migration
 * (supabase/migrations/20260925010000_oauth_grant_sessions.sql).
 *
 * Usage: npm run mcp:lifecycle [baseUrl]    (default http://localhost:3000)
 */
import { createHash, randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

const base = (process.argv[2] ?? "http://localhost:3000").replace(/\/+$/, "");
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const noSession = { persistSession: false, autoRefreshToken: false };
const admin = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: noSession });
const anon = () => createClient(supabaseUrl, anonKey, { auth: noSession });

const checks: { name: string; ok: boolean }[] = [];
function check(name: string, ok: boolean, detail = "") {
  checks.push({ name, ok });
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}
function section(title: string) {
  console.log(`\n${title}`);
}

const b64url = (b: Buffer) =>
  b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const past = () => new Date(Date.now() - 60_000).toISOString();

/** One MCP tool call over Streamable HTTP, reporting the HTTP outcome. */
async function callTool(accessToken: string, name = "list_databases") {
  const response = await fetch(`${base}/api/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: {} },
    }),
  });
  const challenge = response.headers.get("www-authenticate") ?? "";
  if (response.status !== 200) return { ok: false, status: response.status, challenge };
  const body = await response.json();
  const failed = Boolean(body.error) || body.result?.isError === true;
  return { ok: !failed, status: response.status, challenge };
}

let clientId: string | null = null;

try {
  // ------------------------------------------------------------- discovery
  section("Discovery");

  const unauth = await fetch(`${base}/api/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  const discoveryChallenge = unauth.headers.get("www-authenticate") ?? "";
  check(
    "a request without a token gets 401 and a resource_metadata challenge",
    unauth.status === 401 && discoveryChallenge.includes("resource_metadata="),
    String(unauth.status),
  );

  const metadataUrl = /resource_metadata="([^"]+)"/.exec(discoveryChallenge)?.[1] ?? "";
  const prm = await (await fetch(metadataUrl)).json();
  const asm = await (await fetch(`${prm.authorization_servers[0]}/.well-known/oauth-authorization-server`)).json();
  check(
    "resource metadata, issuer and endpoint agree on one origin",
    prm.resource === `${asm.issuer}/api/mcp` && prm.authorization_servers[0] === asm.issuer,
    asm.issuer,
  );

  // ---------------------------------------------------------- registration
  section("Register, authorize, exchange");

  // Claude registers as a confidential client (client_secret_post).
  const redirectUri = "http://localhost:9876/callback";
  const registration = await (
    await fetch(asm.registration_endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ client_name: "lifecycle-check", redirect_uris: [redirectUri] }),
    })
  ).json();
  clientId = registration.client_id;
  const clientSecret: string = registration.client_secret;
  check("dynamic registration issues a client id and secret", Boolean(clientId && clientSecret));

  // A browser session, as the person approving the connection has.
  const { data: signIn, error: signInError } = await anon().auth.signInWithPassword({
    email: process.env.SEED_USER_EMAIL!,
    password: process.env.SEED_USER_PASSWORD!,
  });
  if (signInError) throw signInError;
  const browser = signIn.session!;
  const projectRef = new URL(supabaseUrl).hostname.split(".")[0];
  const cookie = `sb-${projectRef}-auth-token=base64-${Buffer.from(
    JSON.stringify({
      access_token: browser.access_token,
      refresh_token: browser.refresh_token,
      expires_at: browser.expires_at,
      token_type: "bearer",
      user: browser.user,
    }),
  ).toString("base64")}`;

  const verifier = b64url(randomBytes(32));
  const authorizeUrl = new URL(asm.authorization_endpoint);
  authorizeUrl.search = new URLSearchParams({
    client_id: clientId!,
    redirect_uri: redirectUri,
    response_type: "code",
    code_challenge: b64url(createHash("sha256").update(verifier).digest()),
    code_challenge_method: "S256",
    state: "lifecycle",
    resource: prm.resource,
  }).toString();
  const authorized = await fetch(authorizeUrl, { redirect: "manual", headers: { cookie } });
  const code = new URL(authorized.headers.get("location") ?? "", base).searchParams.get("code");
  check("authorize redirects back with a code", Boolean(code), String(authorized.status));

  async function tokenRequest(fields: Record<string, string>) {
    const response = await fetch(asm.token_endpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: clientId!, client_secret: clientSecret, ...fields }),
    });
    return { status: response.status, body: await response.json() };
  }

  const exchanged = await tokenRequest({
    grant_type: "authorization_code",
    code: code!,
    code_verifier: verifier,
    redirect_uri: redirectUri,
  });
  let access: string = exchanged.body.access_token;
  let refresh: string = exchanged.body.refresh_token;
  check(
    "the code exchange issues an access token and a refresh token",
    exchanged.status === 200 && Boolean(access) && Boolean(refresh),
    `expires_in=${exchanged.body.expires_in}s`,
  );

  const { data: tokenRow } = await admin
    .from("oauth_tokens")
    .select("grant_id")
    .eq("access_token_hash", sha256(access))
    .single();
  const grantId: string = tokenRow!.grant_id;
  const { data: grantRow } = await admin
    .from("oauth_grants")
    .select("session_refresh_token")
    .eq("id", grantId)
    .single();
  check(
    "the grant holds a session of its own, not the browser's",
    Boolean(grantRow) && grantRow!.session_refresh_token !== browser.refresh_token,
  );

  // -------------------------------------------------------------- the ask
  section("Call, expire, refresh, call again");

  check("a tool call succeeds", (await callTool(access)).ok);

  await admin.from("oauth_tokens").update({ expires_at: past() }).eq("access_token_hash", sha256(access));
  const expired = await callTool(access);
  check(
    "an expired access token gets 401 with error=\"invalid_token\"",
    expired.status === 401 && expired.challenge.includes('error="invalid_token"'),
    String(expired.status),
  );

  const refreshed = await tokenRequest({ grant_type: "refresh_token", refresh_token: refresh });
  check(
    "refreshing issues a new pair",
    refreshed.status === 200 && refreshed.body.refresh_token !== refresh,
    String(refreshed.status),
  );
  const previousAccess = access;
  access = refreshed.body.access_token;
  refresh = refreshed.body.refresh_token;
  check("the tool call succeeds again with the refreshed token", (await callTool(access)).ok);
  check(
    "the expired token stays refused after the refresh",
    (await callTool(previousAccess)).status === 401,
  );

  // ------------------------------------------------ the workspace session
  section("The grant's own Supabase session");

  await admin.from("oauth_grants").update({ session_expires_at: past() }).eq("id", grantId);
  const burst = await Promise.all(Array.from({ length: 5 }, () => callTool(access)));
  check(
    "five parallel calls as the session expires all succeed",
    burst.every((r) => r.ok),
    burst.map((r) => r.status).join(","),
  );
  check("and the next call still works", (await callTool(access)).ok);

  // The incident: the browser's session trips Supabase's reuse detection.
  let rotated = browser.refresh_token;
  for (let i = 0; i < 3; i += 1) {
    const { data } = await anon().auth.refreshSession({ refresh_token: rotated });
    rotated = data.session!.refresh_token;
  }
  console.log("  ...waiting 12s, past Supabase's reuse interval");
  await sleep(12_000);
  const stale = await anon().auth.refreshSession({ refresh_token: browser.refresh_token });
  check(
    "the browser presenting a stale token has its session revoked by Supabase",
    stale.error?.code === "refresh_token_already_used",
    stale.error?.code ?? "no error",
  );
  await admin.from("oauth_grants").update({ session_expires_at: past() }).eq("id", grantId);
  check(
    "the connector keeps working (this is what used to die)",
    (await callTool(access)).ok,
  );

  // ------------------------------------------------------ lost responses
  section("Refresh tokens that cannot strand the client");

  const lost = await tokenRequest({ grant_type: "refresh_token", refresh_token: refresh });
  const retried = await tokenRequest({ grant_type: "refresh_token", refresh_token: refresh });
  check(
    "a refresh whose response was lost can be retried with the same token",
    lost.status === 200 && retried.status === 200,
    `${lost.status}, ${retried.status}`,
  );
  const inFlight = access;
  access = retried.body.access_token;
  check("the new pair works", (await callTool(access)).ok);
  check(
    "a request in flight with the previous access token still works",
    (await callTool(inFlight)).ok,
  );
  const superseded = await tokenRequest({ grant_type: "refresh_token", refresh_token: refresh });
  check(
    "once the new pair is used, the old refresh token is refused",
    superseded.status === 400 && superseded.body.error === "invalid_grant",
    superseded.body.error_description,
  );

  // ------------------------------------------------------- a real ending
  section("A session that genuinely ends");

  const { data: ending } = await admin
    .from("oauth_grants")
    .select("session_access_token")
    .eq("id", grantId)
    .single();
  await admin.auth.admin.signOut(ending!.session_access_token, "local");
  await admin.from("oauth_grants").update({ session_expires_at: past() }).eq("id", grantId);
  const ended = await callTool(access);
  check(
    "the MCP call gets 401 with error=\"invalid_token\"",
    ended.status === 401 && ended.challenge.includes('error="invalid_token"'),
    String(ended.status),
  );
  const refusedRefresh = await tokenRequest({
    grant_type: "refresh_token",
    refresh_token: retried.body.refresh_token,
  });
  check(
    "and refreshing says invalid_grant, so the client re-authorizes instead of looping",
    refusedRefresh.status === 400 && refusedRefresh.body.error === "invalid_grant",
    refusedRefresh.body.error_description,
  );
} finally {
  // Deleting the client cascades to its codes, grants and tokens.
  if (clientId) await admin.from("oauth_clients").delete().eq("client_id", clientId);
}

const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
