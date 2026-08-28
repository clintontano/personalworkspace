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
  const { data: junk, error } = await admin
    .from("pages")
    .select("id, title")
    .or("title.like.E2E %,title.like.Task 17%");
  if (error) throw error;

  for (const page of junk ?? []) {
    const { error: delError } = await admin.from("pages").delete().eq("id", page.id);
    if (delError) throw delError;
    console.log(`removed: ${page.title}`);
  }
  console.log(`Cleaned ${junk?.length ?? 0} e2e artifact(s).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
