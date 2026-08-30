/**
 * Test fixtures created through the service role, so specs never depend on
 * whatever happens to be in the workspace.
 *
 * The suite used to navigate by seeded titles ("Tasks", "Welcome"). Once the
 * owner renamed or archived those pages, eight specs failed for reasons that
 * had nothing to do with the code under test. Each spec now arranges its own
 * data via the API and acts on it through the UI.
 *
 * Everything is named with FIXTURE_PREFIX so `npm run clean:e2e` can sweep up
 * after a crashed run.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import type { Database, Json } from "../src/lib/database.types";

config({ path: ".env.local", quiet: true });

export const FIXTURE_PREFIX = "E2E~";

let cachedAdmin: SupabaseClient<Database> | null = null;
let cachedWorkspaceId: string | null = null;
let cachedUserId: string | null = null;

function admin(): SupabaseClient<Database> {
  cachedAdmin ??= createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  return cachedAdmin;
}

async function workspaceId(): Promise<string> {
  if (cachedWorkspaceId) return cachedWorkspaceId;
  const { data, error } = await admin()
    .from("workspaces")
    .select("id")
    .order("created_at")
    .limit(1)
    .single();
  if (error) throw error;
  cachedWorkspaceId = data.id;
  return data.id;
}

/** pages.created_by is NOT NULL, so fixtures are attributed to the owner. */
async function ownerId(): Promise<string> {
  if (cachedUserId) return cachedUserId;
  const ws = await workspaceId();
  const { data, error } = await admin()
    .from("workspace_members")
    .select("user_id")
    .eq("workspace_id", ws)
    .limit(1)
    .single();
  if (error) throw error;
  cachedUserId = data.user_id;
  return data.user_id;
}

/** A unique, sweepable name. */
export function fixtureName(label: string): string {
  return `${FIXTURE_PREFIX}${label} ${Date.now()}${Math.floor(Math.random() * 1000)}`;
}

/** Order keys only need to sort; fixtures never reorder. */
const orderKey = (index: number) => `a${String(index).padStart(4, "0")}`;

function paragraph(text: string) {
  return {
    type: "paragraph",
    content: {
      props: {},
      content: [{ type: "text", text, styles: {} }],
    },
  };
}

function heading(text: string, level = 1) {
  return {
    type: "heading",
    content: {
      props: { level },
      content: [{ type: "text", text, styles: {} }],
    },
  };
}

export type FixturePage = { pageId: string; title: string };

/** A plain page with paragraph/heading blocks, optionally with a child page. */
export async function createFixturePage(options: {
  label: string;
  icon?: string;
  blocks?: { text: string; heading?: boolean }[];
  child?: { label: string; blocks?: { text: string }[] };
}): Promise<FixturePage & { child?: FixturePage }> {
  const ws = await workspaceId();
  const owner = await ownerId();
  const title = fixtureName(options.label);

  const { data: page, error } = await admin()
    .from("pages")
    .insert({
      workspace_id: ws,
      created_by: owner,
      title,
      icon: options.icon ?? null,
      order_key: orderKey(9000),
    })
    .select("id")
    .single();
  if (error) throw error;

  const blocks = (options.blocks ?? []).map((b, i) => ({
    workspace_id: ws,
    page_id: page.id,
    type: b.heading ? "heading" : "paragraph",
    content: (b.heading ? heading(b.text) : paragraph(b.text)).content as unknown as Json,
    order_key: orderKey(i),
  }));
  if (blocks.length > 0) {
    const { error: blockError } = await admin().from("blocks").insert(blocks);
    if (blockError) throw blockError;
  }

  let child: FixturePage | undefined;
  if (options.child) {
    const childTitle = fixtureName(options.child.label);
    const { data: childPage, error: childError } = await admin()
      .from("pages")
      .insert({
        workspace_id: ws,
        created_by: owner,
        parent_page_id: page.id,
        title: childTitle,
        order_key: orderKey(0),
      })
      .select("id")
      .single();
    if (childError) throw childError;

    const childBlocks = (options.child.blocks ?? []).map((b, i) => ({
      workspace_id: ws,
      page_id: childPage.id,
      type: "paragraph",
      content: paragraph(b.text).content as unknown as Json,
      order_key: orderKey(i),
    }));
    if (childBlocks.length > 0) {
      const { error: e } = await admin().from("blocks").insert(childBlocks);
      if (e) throw e;
    }
    child = { pageId: childPage.id, title: childTitle };
  }

  return { pageId: page.id, title, child };
}

export const STATUS_OPTIONS = [
  { id: "todo", name: "To do", color: "gray" },
  { id: "doing", name: "In progress", color: "blue" },
  { id: "done", name: "Done", color: "green" },
];

export type FixtureDatabase = {
  databaseId: string;
  title: string;
  statusPropertyId: string;
  duePropertyId: string;
  rowIds: Record<string, string>;
};

/**
 * A database with a Status select and a Due date, table + board views, and
 * the given rows. Mirrors the shape the specs used to borrow from the seed.
 */
export async function createFixtureDatabase(options: {
  label: string;
  rows?: { title: string; status?: string; due?: string }[];
}): Promise<FixtureDatabase> {
  const ws = await workspaceId();
  const owner = await ownerId();
  const title = fixtureName(options.label);

  const { data: page, error } = await admin()
    .from("pages")
    .insert({
      workspace_id: ws,
      created_by: owner,
      title,
      order_key: orderKey(9500),
    })
    .select("id")
    .single();
  if (error) throw error;

  const { error: dbError } = await admin()
    .from("databases")
    .insert({ page_id: page.id, workspace_id: ws });
  if (dbError) throw dbError;

  const { data: props, error: propError } = await admin()
    .from("database_properties")
    .insert([
      {
        database_id: page.id,
        workspace_id: ws,
        name: "Status",
        type: "select",
        config: { options: STATUS_OPTIONS } as unknown as Json,
        order_key: orderKey(0),
      },
      {
        database_id: page.id,
        workspace_id: ws,
        name: "Due",
        type: "date",
        config: {} as Json,
        order_key: orderKey(1),
      },
    ])
    .select("id, name");
  if (propError) throw propError;

  const statusPropertyId = props.find((p) => p.name === "Status")!.id;
  const duePropertyId = props.find((p) => p.name === "Due")!.id;

  const { error: viewError } = await admin()
    .from("views")
    .insert([
      {
        database_id: page.id,
        workspace_id: ws,
        name: "Table",
        type: "table",
        config: {} as Json,
        order_key: orderKey(0),
      },
      {
        database_id: page.id,
        workspace_id: ws,
        name: "Board",
        type: "board",
        config: { groupBy: statusPropertyId } as unknown as Json,
        order_key: orderKey(1),
      },
    ]);
  if (viewError) throw viewError;

  const rowIds: Record<string, string> = {};
  let index = 0;
  for (const row of options.rows ?? []) {
    const { data: rowPage, error: rowPageError } = await admin()
      .from("pages")
      .insert({
        workspace_id: ws,
        created_by: owner,
        parent_page_id: page.id,
        title: row.title,
        order_key: orderKey(index),
      })
      .select("id")
      .single();
    if (rowPageError) throw rowPageError;

    const properties: Record<string, unknown> = {};
    if (row.status) properties[statusPropertyId] = row.status;
    if (row.due) properties[duePropertyId] = row.due;

    const { error: rowError } = await admin().from("database_rows").insert({
      page_id: rowPage.id,
      database_id: page.id,
      workspace_id: ws,
      properties: properties as Json,
      order_key: orderKey(index),
    });
    if (rowError) throw rowError;

    rowIds[row.title] = rowPage.id;
    index++;
  }

  return { databaseId: page.id, title, statusPropertyId, duePropertyId, rowIds };
}

/** An enabled rule that notifies when a row in `databaseId` reaches Done. */
export async function createFixtureAutomation(options: {
  label: string;
  databaseId: string;
  statusPropertyId: string;
}): Promise<{ automationId: string; name: string }> {
  const ws = await workspaceId();
  const owner = await ownerId();
  const name = fixtureName(options.label);
  const { data, error } = await admin()
    .from("automations")
    .insert({
      workspace_id: ws,
      created_by: owner,
      name,
      trigger: {
        type: "row_updated",
        databaseId: options.databaseId,
        filter: {
          combinator: "and",
          conditions: [
            { property: options.statusPropertyId, op: "eq", value: "done" },
          ],
        },
      } as unknown as Json,
      actions: [{ type: "notify", message: "Fixture: {{title}}" }] as unknown as Json,
      enabled: true,
    })
    .select("id")
    .single();
  if (error) throw error;
  return { automationId: data.id, name };
}

/** Delete a fixture page and everything beneath it. */
export async function deleteFixturePage(pageId: string) {
  const { data: children } = await admin()
    .from("pages")
    .select("id")
    .eq("parent_page_id", pageId);
  for (const child of children ?? []) {
    await admin().from("pages").delete().eq("id", child.id);
  }
  await admin().from("pages").delete().eq("id", pageId);
}

export async function deleteFixtureAutomation(automationId: string) {
  await admin().from("automations").delete().eq("id", automationId);
}
