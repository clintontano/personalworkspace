/**
 * Remote MCP smoke test: performs the whole OAuth 2.1 flow against a running
 * deployment, then drives the MCP endpoint over Streamable HTTP.
 *
 * This is the counterpart to `mcp:check` for the local stdio server. It
 * exercises exactly what Claude does when adding a custom connector:
 * discovery -> dynamic registration -> authorize (with PKCE) -> token ->
 * authenticated tool calls.
 *
 * Usage: npm run mcp:remote [baseUrl]
 */
import { createHash, randomBytes } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { createFixtureDatabase, deleteFixturePage } from "../e2e/fixtures";

config({ path: ".env.local", quiet: true });

const base = (process.argv[2] ?? "http://localhost:3000").replace(/\/+$/, "");
const checks: { name: string; ok: boolean; detail: string }[] = [];

function check(name: string, ok: boolean, detail = "") {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}

const b64url = (b: Buffer) =>
  b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

// ---------------------------------------------------------------- discovery

const unauth = await fetch(`${base}/api/mcp`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
});
const challenge = unauth.headers.get("www-authenticate") ?? "";
check(
  "unauthenticated request is refused with a discovery challenge",
  unauth.status === 401 && challenge.includes("resource_metadata"),
  `${unauth.status} ${challenge.slice(0, 80)}`,
);

const prm = await (await fetch(`${base}/.well-known/oauth-protected-resource`)).json();
check(
  "protected resource metadata points at this authorization server",
  prm.resource === `${base}/api/mcp` && prm.authorization_servers?.[0] === base,
  JSON.stringify(prm.authorization_servers),
);

const asm = await (await fetch(`${base}/.well-known/oauth-authorization-server`)).json();
check(
  "authorization server metadata advertises S256 PKCE only",
  asm.code_challenge_methods_supported?.length === 1 &&
    asm.code_challenge_methods_supported[0] === "S256",
  JSON.stringify(asm.code_challenge_methods_supported),
);

// ------------------------------------------------------------- registration

const redirectUri = "http://localhost:9876/callback";
const registration = await (
  await fetch(asm.registration_endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "remote-check",
      redirect_uris: [redirectUri],
      token_endpoint_auth_method: "none",
    }),
  })
).json();
check("dynamic client registration issues a client_id", Boolean(registration.client_id));

const badRedirect = await fetch(asm.registration_endpoint, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ client_name: "bad", redirect_uris: ["http://evil.example.com/cb"] }),
});
check(
  "registration rejects a non-loopback http redirect",
  badRedirect.status === 400,
  String(badRedirect.status),
);

// --------------------------------------------------------------- authorize

// Sign in the way a browser would, so the authorize endpoint sees a session.
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: false } },
);
const { data: signIn, error: signInError } = await supabase.auth.signInWithPassword({
  email: process.env.SEED_USER_EMAIL!,
  password: process.env.SEED_USER_PASSWORD!,
});
if (signInError) throw signInError;

const verifier = b64url(randomBytes(32));
const codeChallenge = b64url(createHash("sha256").update(verifier).digest());

// The route reads the session from cookies; mimic what the browser sends.
const projectRef = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).hostname.split(".")[0];
const cookieValue = encodeURIComponent(
  JSON.stringify({
    access_token: signIn.session!.access_token,
    refresh_token: signIn.session!.refresh_token,
    expires_at: signIn.session!.expires_at,
    token_type: "bearer",
    user: signIn.session!.user,
  }),
);
const cookie = `sb-${projectRef}-auth-token=base64-${Buffer.from(
  decodeURIComponent(cookieValue),
).toString("base64")}`;

const authorizeUrl = new URL(asm.authorization_endpoint);
authorizeUrl.searchParams.set("client_id", registration.client_id);
authorizeUrl.searchParams.set("redirect_uri", redirectUri);
authorizeUrl.searchParams.set("response_type", "code");
authorizeUrl.searchParams.set("code_challenge", codeChallenge);
authorizeUrl.searchParams.set("code_challenge_method", "S256");
authorizeUrl.searchParams.set("state", "xyz");
authorizeUrl.searchParams.set("resource", `${base}/api/mcp`);

const authorized = await fetch(authorizeUrl, { redirect: "manual", headers: { cookie } });
const location = authorized.headers.get("location") ?? "";
const code = new URL(location, base).searchParams.get("code");
check("authorize returns a code to the registered redirect", Boolean(code), location.slice(0, 70));

// A mismatched redirect_uri must never be redirected to.
const tampered = new URL(authorizeUrl);
tampered.searchParams.set("redirect_uri", "https://evil.example.com/cb");
const tamperedResponse = await fetch(tampered, { redirect: "manual", headers: { cookie } });
check(
  "authorize refuses an unregistered redirect_uri",
  tamperedResponse.status === 400,
  String(tamperedResponse.status),
);

// ------------------------------------------------------------------- token

async function exchange(body: Record<string, string>) {
  return fetch(asm.token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });
}

const wrongVerifier = await exchange({
  grant_type: "authorization_code",
  client_id: registration.client_id,
  code: code!,
  code_verifier: b64url(randomBytes(32)),
  redirect_uri: redirectUri,
});
check("token endpoint rejects a bad PKCE verifier", wrongVerifier.status === 400);

const tokenResponse = await exchange({
  grant_type: "authorization_code",
  client_id: registration.client_id,
  code: code!,
  code_verifier: verifier,
  redirect_uri: redirectUri,
});
const tokens = await tokenResponse.json();
check("token endpoint issues an access token", Boolean(tokens.access_token));

const replay = await exchange({
  grant_type: "authorization_code",
  client_id: registration.client_id,
  code: code!,
  code_verifier: verifier,
  redirect_uri: redirectUri,
});
check("an authorization code cannot be replayed", replay.status === 400);

// --------------------------------------------------------------- MCP calls

const fixture = await createFixtureDatabase({
  label: "remote-mcp",
  rows: [{ title: "Remote row", status: "todo" }],
});

try {
  const transport = new StreamableHTTPClientTransport(new URL(`${base}/api/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${tokens.access_token}` } },
  });
  const client = new Client({ name: "remote-check", version: "1.0.0" });
  await client.connect(transport);

  const { tools } = await client.listTools();
  check("remote server exposes the same 8 tools", tools.length === 8, String(tools.length));

  const result = await client.callTool({
    name: "query_database",
    arguments: { database_id: fixture.databaseId },
  });
  const rows = JSON.parse((result.content as { text: string }[])[0].text);
  check(
    "a tool call returns live workspace data",
    Array.isArray(rows) && rows[0]?.title === "Remote row",
    JSON.stringify(rows.map((r: { title: string }) => r.title)),
  );

  await client.close();

  const rejected = await fetch(`${base}/api/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: "Bearer not-a-real-token",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  check("a forged bearer token is rejected", rejected.status === 401, String(rejected.status));
} finally {
  await deleteFixturePage(fixture.databaseId);
}

const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
