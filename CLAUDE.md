# personalworkspace

A personal Notion replacement, single maintainer. Owner directs AI agents and
reviews; Claude implements. Simplicity beats abstraction; speed beats feature
completeness; the data must outlive the app (markdown/JSON export from Phase 2).

## Stack

- Next.js App Router + TypeScript + Tailwind (v4) + shadcn/ui (`src/components/ui`)
- Supabase: Postgres, Auth, Storage, Realtime, Edge Functions
  - Hosted project ref `phlgxknlswghfrkncovn` (linked via `supabase link`)
- Block editor: **BlockNote** (approved; installed in Phase 1)
- Utilities: `zod` (validation), `fractional-indexing` (order keys)
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
- [ ] **Phase 3 — Calendar**: calendar view over date properties; Google
      Calendar two-way sync
- [ ] **Phase 4 — Forms & sites**: public form → database row; publish page
      tree to public slug
- [ ] **Phase 5 — Automations**: declarative jsonb trigger/action rules, edge
      function evaluation, pg_cron scheduling
- [ ] **Phase 6 — MCP server**: search, read/create page, append blocks, query
      database, create/update rows. stdio first.
- [ ] **Phase 7 — Mail**: Gmail OAuth inbox, thread → task row
