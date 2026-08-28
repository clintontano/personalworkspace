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
    .select("role, workspaces(name)")
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
  console.log("Seed complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
