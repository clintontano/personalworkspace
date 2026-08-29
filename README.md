# personalworkspace

A personal Notion replacement: pages and nested blocks, databases with
table/board/list/calendar views, public forms and published sites,
declarative automations, a Gmail inbox, two-way Google Calendar sync, and an
MCP server so Claude can read and write the workspace directly.

Single user by design — there is no public sign-up.

## Stack

Next.js (App Router) · TypeScript · Tailwind v4 · shadcn/ui · BlockNote ·
Supabase (Postgres, Auth, Storage, Realtime, Edge Functions).

Row Level Security is on every table; the public form/site surface goes
through `security definer` RPCs rather than a privileged key.

## Local setup

Requires **Node 22+** (`.nvmrc`) — supabase-js needs native WebSocket.

```bash
npm install
cp .env.example .env.local   # then fill it in
npm run seed                 # creates the user + workspace (idempotent)
npm run dev
```

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server on :3000 |
| `npm run typecheck` / `lint` / `format` | Static checks |
| `npm run test` | Vitest unit tests |
| `npm run test:e2e` | Playwright (reuses a dev server on :3000) |
| `npm run seed` | Create/verify the seed user and workspace |
| `npm run mcp:check` | Drive the MCP server over stdio end to end |
| `npm run clean:e2e` | Remove artifacts of crashed e2e runs |

## Deploying to Vercel

1. Import the repository. Framework preset **Next.js**; no build overrides
   needed. `engines.node` pins Node 22.
2. Add environment variables in **Project Settings → Environment Variables**.
   Only what the running app actually reads — `SEED_USER_*` and `MCP_USER_*`
   belong to the seed script, the e2e suite and the local MCP server, so they
   should **not** be set here:

   | Variable | Needed for |
   | --- | --- |
   | `NEXT_PUBLIC_SUPABASE_URL` | required — the app cannot start work without it |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | required (public by design; RLS is the boundary) |
   | `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Calendar sync and the Gmail inbox |
   | `AUTOMATION_RUN_SECRET` | scheduled automations only |
   | `SUPABASE_SERVICE_ROLE_KEY` | scheduled automations only — the scheduler path runs across every workspace. Omit it and "Run now" still works under your own session |

   The build succeeds with none of these set; a green build does not mean a
   working app.

3. **After the first deploy, add the deployed callback URL to the Google
   OAuth client**, or connecting Google fails with `redirect_uri_mismatch`.
   The app derives the redirect from the request origin, so it needs:

   ```
   https://<your-domain>/api/google/callback
   ```

   Add it alongside the existing localhost entry in Google Cloud Console →
   Google Auth Platform → Clients. Google notes changes can take a few
   minutes to apply.

4. Scheduled automations need the app to be reachable from Supabase, which is
   why they only work once deployed. See `scripts/pg_cron_setup.sql`; deploy
   the edge function with `--use-api` so no Docker is required.

## MCP server

`mcp/server.mts` exposes the workspace to Claude over stdio. It signs in as
the workspace user and runs entirely under that user's RLS — it never touches
the service-role key. A project-scoped `.mcp.json` is committed, so opening
this repo in Claude Code offers the server for approval. See
[`mcp/README.md`](mcp/README.md) for the desktop-app setup and the tool list.

## Notes

`CLAUDE.md` holds the working conventions and the data-model decision log.
