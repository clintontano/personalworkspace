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
  `fractional-indexing`, indexed alongside the parent columns. **Only ever
  generate these with `generateKeyBetween`** — hand-rolled strings like
  `a9000` look ordered but are not valid keys, and the library throws
  (`Error: 004 >= 004`) the first time something is dragged between two of
  them.
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
  to dodge auth rate limits). **Specs create their own fixtures**
  (`e2e/fixtures.ts`, service role) rather than navigating to seeded titles —
  renaming or archiving a workspace page used to break eight unrelated specs.
  Fixtures are named with the `E2E~` prefix and removed in a `finally`;
  `npm run clean:e2e` sweeps what a crashed run leaves behind.
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

## Remote MCP server (OAuth)

- `/api/mcp` is the Streamable HTTP endpoint; `mcp/server.mts` is the local
  stdio one. Both register the same tools from `src/lib/mcp/tools.ts`, so the
  two surfaces cannot drift.
- Claude's custom-connector UI has **no field for a bearer token or custom
  header** — only OAuth client id/secret — so a remote MCP server has to
  speak OAuth 2.1 to be addable at all. The app is both the resource server
  and the authorization server: `/.well-known/oauth-protected-resource`
  (RFC 9728), `/.well-known/oauth-authorization-server` (RFC 8414),
  `/api/oauth/register` (RFC 7591), `/api/oauth/authorize`, `/api/oauth/token`.
- S256 PKCE only, exact redirect-URI matching, single-use codes, rotating
  refresh tokens, and audience binding against this deployment's `/api/mcp`.
  Tokens and codes are stored as sha256 hashes.
- **It still runs under the user's RLS.** The authorize step captures the
  signed-in user's Supabase refresh token with the grant, and `/api/mcp`
  rebuilds *their* session per request — the service role is used only for
  the OAuth tables, never for workspace data.
- `npm run mcp:remote [baseUrl]` drives the whole flow against a running
  deployment the way Claude does.
- **The OAuth tables had to be created by hand** (`scripts/oauth_setup.sql`):
  `supabase db push` recorded those migrations in the history without
  committing their DDL, leaving the history claiming tables that did not
  exist. If a push ever hangs and is killed, verify the schema rather than
  trusting `migration list`.

## MCP server

- `mcp/server.mts` (stdio). A project-scoped `.mcp.json` is committed, so
  opening this repo in Claude Code offers the server for approval; see
  `mcp/README.md` for manual registration.
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
- **Launchers must set the working directory.** tsx resolves the `@/` path
  alias against cwd, so a launcher starting the server from `/` dies on
  `Cannot find module '@/lib/...'`. Claude Code gets this free from the
  project-scoped `.mcp.json`; the desktop app needs
  `zsh -lc "cd <project> && exec npx tsx mcp/server.mts"`, which also picks
  up the nvm-pinned Node 22.

## Automations

- Rules are declarative jsonb (`automations.trigger` / `.actions`) reusing the
  view `FilterGroup` shape, so a richer UI can be built on the same format.
- Row changes are queued by a trigger into `automation_events` (Postgres
  cannot call an edge function directly). The runner drains that queue and
  evaluates scheduled rules in the same pass.
- The trigger sets `app.automation_run` so writes made *by* the runner do not
  re-enqueue events — no feedback loops.
- `automation_events` needs an **update** policy, not just a read one: "Run
  now" executes as the signed-in user, and RLS rejects a forbidden update by
  changing zero rows rather than raising. Without it the runner silently
  failed to set `processed_at`, reprocessed the same oldest batch forever and
  the queue grew without bound. The runner now checks the update landed. `isNoopUpdate` also skips updates
  that would change nothing.
- **Deviation from the original plan, deliberate**: the rule engine runs in
  the Next.js route `POST /api/automations/run`, not inside the edge function.
  The engine shares `src/lib/db/filters` with the views; duplicating it into a
  Deno function would mean two implementations of the same semantics. The
  edge function (`supabase/functions/automations`) is the *scheduled trigger*
  that invokes the route. pg_cron → edge function → route.
- Scheduling is not active until the app is deployed (pg_cron cannot reach a
  dev machine). `scripts/pg_cron_setup.sql` documents the one-time setup; the
  Automations page has "Run now" for local use. Deploy the function with
  `--use-api` so no Docker is needed on this machine.
- Cron matching is hand-rolled (`src/lib/automations/schedule.ts`, 5-field,
  unit-tested) rather than adding a dependency.

## Inline databases

- A database can be embedded in any page: `/database` in the slash menu
  creates a real database page nested under the current one and inserts a
  `database` block holding only its page id.
- Because the embed is a normal database page, it appears in the sidebar
  tree, opens as its own page, and is reachable from the MCP server,
  automations and export with no special casing.
- The block is rendered by `components/editor/inline-database.tsx`, which
  reuses `DatabaseScreen` in `inline` mode rather than duplicating view logic.
- Data is fetched **server-side** in the page route (`databaseIdsInBlocks` +
  `fetchBundleWith` in `lib/db/bundle.ts`) and seeded into the client cache,
  so an embed paints with the page instead of after a second round trip. The
  client fetch path is only used for databases inserted after load.
- Blocks read data through `use()` with a cached promise, not effects —
  React Compiler lint forbids synchronous setState in effects.
- Deleting the block leaves the database page in the tree, which is what
  Notion does; the data is not silently destroyed.

## Drag and drop

- Native HTML5 drag throughout (board cards, table columns, sidebar pages) —
  no drag library.
- **`dragover` must call `preventDefault()` synchronously or the drop never
  happens.** Only one dragover may fire for a quick drag, and a guard that
  reads React state set in `dragstart` will not see it yet, so the dragged id
  is held in a ref and the payload is read from `dataTransfer` on drop.
- Reorder arithmetic is pure and unit-tested (`src/lib/reorder.ts`):
  `keyForMove` returns null for no-op moves so nothing is written,
  `isWithinSubtree` refuses to nest a page inside its own descendants, and
  `dropZone` maps pointer position to before/inside/after bands.
- Column widths are per-view (`config.columnWidths`, keyed by property id
  plus `"title"`); column order is the property's own `order_key`, so it is a
  property of the database rather than of one view. The table uses
  `table-layout: fixed` with a `<colgroup>`, so a resize moves one `<col>`
  rather than reflowing every cell.
- Resizing tracks locally during the drag and persists on pointer-up, so the
  column follows the cursor rather than the network.

## Theming

- Light / dark / system, hand-rolled in `src/lib/theme.ts` +
  `components/theme-provider.tsx` — no `next-themes` dependency.
- The preference is a `dark` class on `<html>` (matching globals.css) plus
  `color-scheme`, applied by an inline `<head>` script before first paint so
  there is no flash of the wrong theme.
- The provider reads localStorage and `matchMedia` through
  `useSyncExternalStore`, not effects: React Compiler lint forbids
  synchronous setState in effects, and these genuinely are external stores.
  A module-level `sessionPreference` keeps the toggle working when storage is
  blocked (private windows).
- BlockNote receives the resolved theme; select-option colours carry explicit
  `dark:` variants (light tints are unreadable on dark surfaces).
- **One continuous surface.** Text inputs, selects and outline buttons are
  transparent rather than filled, and BlockNote's own editor background is
  overridden to transparent in `globals.css` (it otherwise paints a lighter
  slab inside the page). BlockNote sets those variables on
  `.bn-root[data-color-scheme=dark]`, so the override needs matching
  specificity to win. Popovers and dropdowns keep their elevated background —
  they float above the page rather than sitting in it.
- Public pages (forms, published sites) inherit the same script, so they
  follow the visitor's OS setting.

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
- Dates display as "Jan 1 2026" (`formatDateDisplay`). A native date input
  always renders the browser's numeric locale format and cannot be restyled,
  so cells show formatted text at rest and swap to the native input while
  editing, which keeps the built-in calendar picker. All-day values are
  formatted from their string parts, never through `new Date`, which would
  read them as UTC midnight and show the previous day west of Greenwich.
- **Date values carry their own precision** (`src/lib/db/date-value.ts`): a
  plain `2026-08-29` is all-day, a full ISO string is timed. No schema change
  was needed — existing all-day values keep working. Sorting compares
  instants (UTC offsets do not sort lexicographically); filters stay
  day-level so "is on the 29th" matches any time that day.
- A timed row becomes a **point in time** in Google Calendar, not a padded
  block: a task at 2pm is at 2pm rather than occupying 2–3pm. Google accepts
  an event whose end equals its start. Existing events keep their real
  duration — the patch path reads it before writing.
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
