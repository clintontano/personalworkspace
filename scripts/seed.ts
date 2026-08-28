/**
 * Seed script: creates the workspace owner user (idempotent).
 * The on_auth_user_created trigger provisions the workspace + membership.
 *
 * Usage: npm run seed
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const required = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SEED_USER_EMAIL",
  "SEED_USER_PASSWORD",
] as const;

for (const key of required) {
  if (!process.env[key]) {
    console.error(`Missing ${key} in .env.local`);
    process.exit(1);
  }
}

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

async function main() {
  const email = process.env.SEED_USER_EMAIL!;

  const { data: list, error: listError } = await admin.auth.admin.listUsers({
    perPage: 1000,
  });
  if (listError) throw listError;

  let user = list.users.find((u) => u.email === email);

  if (user) {
    console.log(`User already exists: ${email}`);
  } else {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: process.env.SEED_USER_PASSWORD!,
      email_confirm: true,
    });
    if (error) throw error;
    user = data.user!;
    console.log(`Created user: ${email}`);
  }

  const { data: memberships, error: memberError } = await admin
    .from("workspace_members")
    .select("workspace_id, role, workspaces(name)")
    .eq("user_id", user.id);
  if (memberError) throw memberError;

  if (!memberships?.length) {
    throw new Error(
      "No workspace found for user — the on_auth_user_created trigger did not run.",
    );
  }

  for (const m of memberships) {
    const ws = m.workspaces as unknown as { name: string };
    console.log(`Workspace: "${ws.name}" (${m.role})`);
  }

  await seedPages(user.id, memberships[0].workspace_id as string);
  console.log("Seed complete.");
}

type SeedBlock = {
  type: string;
  text: string;
  props?: Record<string, unknown>;
  children?: SeedBlock[];
};

const welcomeBlocks: SeedBlock[] = [
  { type: "heading", text: "Welcome to your workspace", props: { level: 1 } },
  {
    type: "paragraph",
    text: "This is your personal Notion replacement. Everything you see is stored in your own Supabase project.",
  },
  { type: "heading", text: "Try the editor", props: { level: 2 } },
  { type: "bulletListItem", text: "Type / for the slash menu" },
  { type: "bulletListItem", text: "Use markdown shortcuts: # for headings, - for lists" },
  {
    type: "bulletListItem",
    text: "Drag blocks by their handle to reorder",
    children: [{ type: "bulletListItem", text: "Nested blocks work too — try Tab" }],
  },
  {
    type: "paragraph",
    text: "Open this page in two tabs and edit in one: the other follows.",
  },
];

async function seedPages(userId: string, workspaceId: string) {
  const { count } = await admin
    .from("pages")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId);
  if ((count ?? 0) > 0) {
    console.log("Pages already seeded.");
    return;
  }

  const { keyAfter } = await import("../src/lib/order");

  let pageKey: string | null = null;
  const nextPageKey = () => (pageKey = keyAfter(pageKey));

  const insertPage = async (
    title: string,
    icon: string | null,
    parentPageId: string | null,
    orderKey: string,
  ) => {
    const { data, error } = await admin
      .from("pages")
      .insert({
        workspace_id: workspaceId,
        parent_page_id: parentPageId,
        title,
        icon,
        order_key: orderKey,
        created_by: userId,
      })
      .select("id")
      .single();
    if (error) throw error;
    return data.id as string;
  };

  const insertBlocks = async (
    pageId: string,
    blocks: SeedBlock[],
    parentBlockId: string | null = null,
  ) => {
    let key: string | null = null;
    for (const b of blocks) {
      key = keyAfter(key);
      const { data, error } = await admin
        .from("blocks")
        .insert({
          workspace_id: workspaceId,
          page_id: pageId,
          parent_block_id: parentBlockId,
          type: b.type,
          content: {
            props: b.props ?? {},
            content: [{ type: "text", text: b.text, styles: {} }],
          },
          order_key: key,
        })
        .select("id")
        .single();
      if (error) throw error;
      if (b.children?.length) await insertBlocks(pageId, b.children, data.id as string);
    }
  };

  const welcomeId = await insertPage("Welcome", "👋", null, nextPageKey());
  await insertBlocks(welcomeId, welcomeBlocks);

  const gettingStartedId = await insertPage(
    "Getting started",
    "🚀",
    welcomeId,
    keyAfter(null),
  );
  await insertBlocks(gettingStartedId, [
    { type: "paragraph", text: "A nested page. The sidebar tree goes as deep as you like." },
  ]);

  const scratchId = await insertPage("Scratchpad", "✏️", null, nextPageKey());
  await insertBlocks(scratchId, [
    { type: "paragraph", text: "An empty-ish page to mess around in." },
  ]);

  console.log("Seeded 3 pages with blocks.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
