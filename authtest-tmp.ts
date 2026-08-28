import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
config({ path: ".env.local" });
async function main() {
  const c = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
  const { data, error } = await c.auth.signInWithPassword({
    email: process.env.SEED_USER_EMAIL!,
    password: process.env.SEED_USER_PASSWORD!,
  });
  console.log(error ? `ERROR status=${error.status} code=${error.code}: ${error.message}` : `OK user ${data.user?.email}`);
}
main();
