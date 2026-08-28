/**
 * Remove artifacts left behind by failed e2e runs (the suite runs against the
 * hosted project and normally cleans up after itself).
 *
 * Usage: npm run clean:e2e
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

async function main() {
  let removed = 0;

  const { data: junk, error } = await admin
    .from("pages")
    .select("id, title")
    .or("title.like.E2E %,title.like.Task 17%,title.like.Form row %,title.like.MCP smoke%");
  if (error) throw error;

  for (const page of junk ?? []) {
    const { error: delError } = await admin.from("pages").delete().eq("id", page.id);
    if (delError) throw delError;
    console.log(`removed page: ${page.title}`);
    removed++;
  }

  // Forms and sites the specs create through the UI. Both use generated
  // slugs, so a crashed run leaves them behind.
  const { data: forms } = await admin
    .from("forms")
    .select("id, title")
    .like("title", "% form");
  for (const form of forms ?? []) {
    await admin.from("forms").delete().eq("id", form.id);
    console.log(`removed form: ${form.title}`);
    removed++;
  }

  const { data: sites } = await admin.from("sites").select("id, slug");
  for (const site of sites ?? []) {
    await admin.from("sites").delete().eq("id", site.id);
    console.log(`removed site: ${site.slug}`);
    removed++;
  }

  console.log(`Cleaned ${removed} e2e artifact(s).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
