# personalworkspace

A personal Notion replacement, single maintainer. Owner directs AI agents and
reviews; Claude implements. Simplicity beats abstraction; speed beats feature
completeness; the data must outlive the app (markdown/JSON export from Phase 2).

## Stack

- Next.js App Router + TypeScript + Tailwind (v4) + shadcn/ui (`src/components/ui`)
- Supabase: Postgres, Auth, Storage, Realtime, Edge Functions
  - Hosted project ref `phlgxknlswghfrkncovn` (linked via `supabase link`)
- Block editor: **BlockNote** (approved; installed in Phase 1)
- Utilities: `zod` (validation), `fractional-indexing` (order keys),
  `@modelcontextprotocol/sdk` (Phase 6 MCP server)
- Tests: Vitest for real logic, one Playwright happy path per phase (`e2e/`)

## Dev environment

- **Node 22+** (`.nvmrc`) — supabase-js requires native WebSocket; Node 20 throws at client construction.
- **No Docker on this machine** → development currently runs against the hosted
  Supabase project. When a container runtime is installed, switch to
  `supabase start` and local-first development.
- `.env.local` holds all keys and seed credentials — never committed.
  `.env.example` documents the required vars.
- **Never write Supabase keys into committed files.** The service_role key is
  fetched via `supabase projects api-keys --project-ref <ref>` into `.env.local`.
- Single-user posture: **no public sign-up UI**. The seed script creates the
  user (`npm run seed`, idempotent); the signup trigger provisions the workspace.

## Commands

- `npm run dev` — dev server
- `npm run typecheck` / `npm run lint` / `npm run test` (Vitest) / `npm run test:e2e` (Playwright, boots its own dev server on :3111)
- `npm run seed` — create/verify the seed user + workspace
- `npm run format` — prettier

## Migration workflow

1. `supabase migration new <name>` → edit the SQL file in `supabase/migrations/`
2. `supabase db push` — applies to the linked (hosted) database
3. `supabase gen types typescript --linked > src/lib/database.types.ts` after
   every schema change
4. Never edit an applied migration; write a new one.

## Conventions

- **RLS on every table at creation.** Every table carries `workspace_id`
  (denormalized) so policies are a single `is_workspace_member(workspace_id)`
  call — no policy-time joins. Helpers are `security definer` with
  `set search_path = ''`.
- Every table: `created_at`, `updated_at` (maintained by the `set_updated_at`
  trigger), `created_by` where meaningful. Automations (Phase 5) rely on
  `updated_at` being trustworthy.
- Ordering (blocks, pages, rows): fractional index strings via
  `fractional-indexing`, indexed alongside the parent columns.
- Supabase clients live in `src/lib/supabase/` (browser/server/middleware
  variants), typed with generated `Database` types.
- No state-management library until something actually hurts.
- **Block persistence**: BlockNote document is diffed against a mirror of the
  stored rows (`src/lib/blocks/sync.ts`) — minimal upserts/deletes per save,
  LIS-based order-key stability (`src/lib/order.ts`). Debounced 500ms.
- **Realtime**: Supabase broadcast channels only (no postgres_changes), via
  `src/lib/realtime.ts`. One shared channel per topic (a topic joins a socket
  at most once — send and receive must share the channel), wildcard binding,
  local handler dispatch, `self: true` echo. Topics: `ws-<workspaceId>`
  ("pages" event, sidebar refresh), `page-<pageId>` ("blocks" event, cross-tab
  block sync filtered by origin id).
- **Database query layer** (`src/lib/db/`): filters/sorts/grouping are
  declarative jsonb (view config, reused by automations) evaluated in TS over
  rows fetched by database_id. At personal scale this beats pushing dynamic
  jsonb predicates through PostgREST; revisit only on measured slowness.
- **E2E**: auth once via `e2e/auth.setup.ts` (session state reused across runs
  to dodge auth rate limits); specs self-clean; `npm run clean:e2e` removes
  artifacts of crashed runs.
- Playwright e2e reuses an already-running dev server on :3000 (Next 16
  allows one dev server per project).

## Data model decisions (log)

- No `pages.is_database` boolean — the presence of a `databases` row keyed on
  `page_id` is the flag.
- No per-property generated columns or runtime DDL. GIN index on the row
  properties jsonb; add hand-written expression indexes only when a measured
  slowdown appears.
- Row title = page title (a database row IS a page); no duplicate "Name"
  property in the properties jsonb.
- `views`: `type` is a column; filters/sorts/visible properties/grouping live
  in one `config` jsonb.
- Relations: page-id arrays inside the property value jsonb until
  backlinks/rollups force a junction table. Delete paths must clean up
  dangling refs.

## Mail

- Gmail is read-only (`gmail.readonly`) and optional: without OAuth
  credentials the Mail page states the setup instead of erroring.
- Message parsing is pure and unit-tested (`src/lib/gmail/parse.ts`): header
  lookup, base64url bodies, nested MIME parts, text/plain preferred over
  stripped HTML, thread summarization.
- The inbox is fetched **server-side** in the page (`lib/gmail/inbox.ts`,
  shared with the refresh route) — no client effect, one round trip. React
  Compiler lint forbids synchronous setState in effects, and server fetching
  is the better answer anyway.
- Thread → row reuses `lib/mcp/api.ts` `createRow`, so property coercion is
  identical to the MCP path; the row body is the thread as markdown with a
  Gmail deep link.

## MCP server

- `mcp/server.mts` (stdio). See `mcp/README.md` for registering it with Claude
  Code / Desktop.
- **Runs under the user's RLS**: it signs in with MCP_USER_EMAIL/PASSWORD
  (falling back to SEED_USER_*) and never touches the service-role key.
- Tool logic lives in `src/lib/mcp/api.ts` so the app and the server share one
  implementation of filters, sorts and markdown conversion.
- Property references are forgiving: names or ids, option labels or ids
  (`coerceValue` / `resolveProperty`, unit-tested).
- `search_workspace` RPC is SECURITY INVOKER — the caller's RLS applies, so
  search can only return what the caller can already read.
- Phase 6's happy path is `npm run mcp:check` (drives the real server over
  stdio, then cleans up) rather than a Playwright test — the deliverable has
  no UI.
- The file is `.mts`: tsx compiles `.ts` here as CJS, which rejects top-level
  await and ESM-only SDK imports.

## Automations

- Rules are declarative jsonb (`automations.trigger` / `.actions`) reusing the
  view `FilterGroup` shape, so a richer UI can be built on the same format.
- Row changes are queued by a trigger into `automation_events` (Postgres
  cannot call an edge function directly). The runner drains that queue and
  evaluates scheduled rules in the same pass.
- The trigger sets `app.automation_run` so writes made *by* the runner do not
  re-enqueue events — no feedback loops. `isNoopUpdate` also skips updates
  that would change nothing.
- **Deviation from the original plan, deliberate**: the rule engine runs in
  the Next.js route `POST /api/automations/run`, not inside the edge function.
  The engine shares `src/lib/db/filters` with the views; duplicating it into a
  Deno function would mean two implementations of the same semantics. The
  edge function (`supabase/functions/automations`) is the *scheduled trigger*
  that invokes the route. pg_cron → edge function → route.
- Scheduling is not active until the app is deployed (pg_cron cannot reach a
  dev machine). `scripts/pg_cron_setup.sql` documents the one-time setup; the
  Automations page has "Run now" for local use.
- Cron matching is hand-rolled (`src/lib/automations/schedule.ts`, 5-field,
  unit-tested) rather than adding a dependency.

## Public surfaces (forms and sites)

- **anon has no table policies at all.** Every public read/write goes through
  a `security definer` RPC, so the public surface is fixed in SQL rather than
  depending on route code holding a service-role key:
  - `get_public_form(slug)` / `submit_public_form(slug, data)` — only enabled
    forms; only property ids belonging to that form's database are accepted;
    required fields enforced in SQL.
  - `get_public_site_page(slug, page_id)` — only published sites, and only
    pages inside the site root's subtree (recursive CTE check).
- Public routes use `createPublicClient()` (anon key, no session), never the
  service-role key. Routes: `/f/<slug>` forms, `/s/<slug>[/<pageId>]` sites.
- Blocks are re-rendered read-only for sites (`components/public/render-blocks`).

## Google integration

- OAuth is optional: without `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` the
  Settings page explains the setup and the routes return 501. Redirect URI:
  `http://localhost:3000/api/google/callback`.
- `google_connections` holds tokens per (user, kind); RLS is owner-only.
  Refresh tokens arrive only on first consent — re-connects keep the stored one.
- Calendar sync (`POST /api/google/sync`) runs pull-then-push per call.
  Planning logic is pure and unit-tested (`src/lib/google/calendar-sync.ts`);
  the route only does I/O. Rows link to events via a reserved `_gcal` key in
  the properties jsonb (underscore keys are ignored by the UI). Incremental
  via syncToken, falling back to a full resync on 410.

## How to work (owner's rules)

1. Keep this file current.
2. One phase at a time. At phase end: stop, summarize, wait for review. Do not
   run ahead.
3. Every phase ends with the app running locally with seed data + a short
   "what to look at" note.
4. Commit per phase on a `phase-N-<name>` branch. Never push without asking.
5. Tests cover what silently breaks (ordering, filters, automation rules), not
   exhaustive coverage.
6. Ask before adding dependencies not listed here and before
   expensive-to-reverse design decisions.
7. Never commit Supabase keys.

## Phase plan

- [x] **Phase 0 — Foundation**: scaffold, email+password sign-in (no public
      sign-up), workspaces + membership + RLS, signup trigger, seed, CI
- [x] **Phase 1 — Pages & blocks**: sidebar page tree, nested pages, BlockNote
      editor, fractional ordering, realtime across tabs
- [x] **Phase 2 — Databases**: property types, rows-as-pages, table view
      (filter/sort/group), board view, query layer, markdown/JSON export
- [x] **Phase 3 — Calendar**: calendar view over date properties; Google
      Calendar two-way sync (needs GOOGLE_CLIENT_ID/SECRET to activate)
- [x] **Phase 4 — Forms & sites**: public form → database row; publish page
      tree to public slug
- [x] **Phase 5 — Automations**: declarative jsonb trigger/action rules, edge
      function trigger, pg_cron scheduling (see note below)
- [x] **Phase 6 — MCP server**: search, read/create page, append blocks, query
      database, create/update rows (local stdio)
- [x] **Phase 7 — Mail**: Gmail OAuth inbox, thread → task row
