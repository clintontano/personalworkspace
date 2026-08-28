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
  await seedDatabases(user.id, memberships[0].workspace_id as string);
  await seedEvents(user.id, memberships[0].workspace_id as string);
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

async function seedDatabases(userId: string, workspaceId: string) {
  const { count } = await admin
    .from("databases")
    .select("page_id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId);
  if ((count ?? 0) > 0) {
    console.log("Databases already seeded.");
    return;
  }

  const { keyAfter } = await import("../src/lib/order");
  const { randomUUID } = await import("node:crypto");

  const { data: lastPage } = await admin
    .from("pages")
    .select("order_key")
    .eq("workspace_id", workspaceId)
    .is("parent_page_id", null)
    .order("order_key", { ascending: false })
    .limit(1)
    .maybeSingle();
  let rootKey = lastPage?.order_key ?? null;

  const createDb = async (title: string, icon: string) => {
    rootKey = keyAfter(rootKey);
    const { data: page, error } = await admin
      .from("pages")
      .insert({
        workspace_id: workspaceId,
        title,
        icon,
        order_key: rootKey,
        created_by: userId,
      })
      .select("id")
      .single();
    if (error) throw error;
    const { error: dbErr } = await admin
      .from("databases")
      .insert({ page_id: page.id, workspace_id: workspaceId });
    if (dbErr) throw dbErr;
    return page.id as string;
  };

  const addProp = async (
    databaseId: string,
    name: string,
    type: string,
    config: Record<string, unknown>,
    orderKey: string,
  ) => {
    const id = randomUUID();
    const { error } = await admin.from("database_properties").insert({
      id,
      database_id: databaseId,
      workspace_id: workspaceId,
      name,
      type,
      config,
      order_key: orderKey,
    });
    if (error) throw error;
    return id;
  };

  const addView = async (
    databaseId: string,
    name: string,
    type: string,
    config: Record<string, unknown>,
    orderKey: string,
  ) => {
    const { error } = await admin.from("views").insert({
      database_id: databaseId,
      workspace_id: workspaceId,
      name,
      type,
      config,
      order_key: orderKey,
    });
    if (error) throw error;
  };

  const addDbRow = async (
    databaseId: string,
    title: string,
    properties: Record<string, unknown>,
    orderKey: string,
  ) => {
    const { data: page, error } = await admin
      .from("pages")
      .insert({
        workspace_id: workspaceId,
        parent_page_id: databaseId,
        title,
        order_key: keyAfter(null),
        created_by: userId,
      })
      .select("id")
      .single();
    if (error) throw error;
    const { error: rowErr } = await admin.from("database_rows").insert({
      page_id: page.id,
      database_id: databaseId,
      workspace_id: workspaceId,
      properties,
      order_key: orderKey,
    });
    if (rowErr) throw rowErr;
    return page.id as string;
  };

  // Tasks database
  const tasksId = await createDb("Tasks", "✅");
  const status = await addProp(tasksId, "Status", "select", {
    options: [
      { id: "todo", name: "To do", color: "gray" },
      { id: "in-progress", name: "In progress", color: "blue" },
      { id: "done", name: "Done", color: "green" },
    ],
  }, "a0");
  const due = await addProp(tasksId, "Due", "date", {}, "a1");
  const tags = await addProp(tasksId, "Tags", "multi_select", {
    options: [
      { id: "home", name: "Home", color: "red" },
      { id: "work", name: "Work", color: "purple" },
      { id: "errand", name: "Errand", color: "yellow" },
    ],
  }, "a2");
  const link = await addProp(tasksId, "Link", "url", {}, "a3");

  await addView(tasksId, "Table", "table", {}, "a0");
  await addView(tasksId, "Board", "board", { groupBy: status }, "a1");
  await addView(tasksId, "List", "list", {}, "a2");

  const today = new Date();
  const iso = (offsetDays: number) => {
    const d = new Date(today);
    d.setDate(d.getDate() + offsetDays);
    return d.toISOString().slice(0, 10);
  };

  const t1 = await addDbRow(tasksId, "Review Phase 2", {
    [status]: "in-progress", [due]: iso(1), [tags]: ["work"],
  }, "a0");
  await addDbRow(tasksId, "Pay rent", {
    [status]: "todo", [due]: iso(3), [tags]: ["home"],
  }, "a1");
  await addDbRow(tasksId, "Buy groceries", {
    [status]: "todo", [due]: iso(0), [tags]: ["home", "errand"],
  }, "a2");
  await addDbRow(tasksId, "Set up CI secrets", {
    [status]: "done", [tags]: ["work"], [link]: "https://github.com",
  }, "a3");
  await addDbRow(tasksId, "Plan the week", { [status]: "todo" }, "a4");

  // Notes database with a relation to Tasks
  const notesId = await createDb("Notes", "📝");
  const topic = await addProp(notesId, "Topic", "select", {
    options: [
      { id: "ideas", name: "Ideas", color: "purple" },
      { id: "meetings", name: "Meetings", color: "blue" },
      { id: "journal", name: "Journal", color: "green" },
    ],
  }, "a0");
  const related = await addProp(notesId, "Related tasks", "relation", {
    databaseId: tasksId,
  }, "a1");

  await addView(notesId, "Table", "table", {}, "a0");
  await addView(notesId, "List", "list", {}, "a1");

  await addDbRow(notesId, "Workspace app ideas", {
    [topic]: "ideas", [related]: [t1],
  }, "a0");
  await addDbRow(notesId, "Weekly review", { [topic]: "journal" }, "a1");

  console.log("Seeded Tasks + Notes databases.");
}

async function seedEvents(userId: string, workspaceId: string) {
  const { data: existing } = await admin
    .from("pages")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("title", "Events")
    .maybeSingle();
  if (existing) {
    console.log("Events already seeded.");
    return;
  }

  const { keyAfter } = await import("../src/lib/order");
  const { randomUUID } = await import("node:crypto");

  const { data: lastPage } = await admin
    .from("pages")
    .select("order_key")
    .eq("workspace_id", workspaceId)
    .is("parent_page_id", null)
    .order("order_key", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: page, error } = await admin
    .from("pages")
    .insert({
      workspace_id: workspaceId,
      title: "Events",
      icon: "📅",
      order_key: keyAfter(lastPage?.order_key ?? null),
      created_by: userId,
    })
    .select("id")
    .single();
  if (error) throw error;
  const eventsId = page.id as string;
  await admin.from("databases").insert({ page_id: eventsId, workspace_id: workspaceId });

  // PostgREST bulk inserts require identical keys on every record.
  const dateId = randomUUID();
  const kindId = randomUUID();
  const { error: propsError } = await admin.from("database_properties").insert([
    {
      id: dateId,
      database_id: eventsId,
      workspace_id: workspaceId,
      name: "Date",
      type: "date",
      config: {},
      order_key: "a0",
    },
    {
      id: kindId,
      database_id: eventsId,
      workspace_id: workspaceId,
      name: "Kind",
      type: "select",
      config: {
        options: [
          { id: "appointment", name: "Appointment", color: "blue" },
          { id: "birthday", name: "Birthday", color: "pink" },
          { id: "trip", name: "Trip", color: "green" },
        ],
      },
      order_key: "a1",
    },
  ]);
  if (propsError) throw propsError;

  const { error: viewsError } = await admin.from("views").insert([
    {
      database_id: eventsId,
      workspace_id: workspaceId,
      name: "Calendar",
      type: "calendar",
      config: { dateProperty: dateId },
      order_key: "a0",
    },
    {
      database_id: eventsId,
      workspace_id: workspaceId,
      name: "Table",
      type: "table",
      config: {},
      order_key: "a1",
    },
  ]);
  if (viewsError) throw viewsError;

  const today = new Date();
  const iso = (offset: number) => {
    const d = new Date(today);
    d.setDate(d.getDate() + offset);
    return d.toISOString().slice(0, 10);
  };

  const addEvent = async (title: string, date: string, kind: string, orderKey: string) => {
    const { data: p, error: pageErr } = await admin
      .from("pages")
      .insert({
        workspace_id: workspaceId,
        parent_page_id: eventsId,
        title,
        order_key: keyAfter(null),
        created_by: userId,
      })
      .select("id")
      .single();
    if (pageErr) throw pageErr;
    await admin.from("database_rows").insert({
      page_id: p.id,
      database_id: eventsId,
      workspace_id: workspaceId,
      properties: { [dateId]: date, [kindId]: kind },
      order_key: orderKey,
    });
  };

  await addEvent("Dentist", iso(2), "appointment", "a0");
  await addEvent("Mom's birthday", iso(6), "birthday", "a1");
  await addEvent("Weekend trip", iso(9), "trip", "a2");

  console.log("Seeded Events database with calendar view.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
