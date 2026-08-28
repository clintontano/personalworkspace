import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { publicEnv } from "@/lib/env";

/**
 * Anon client with no auth session, for public (unauthenticated) pages. Anon
 * has no table policies — it can only reach the security definer RPCs.
 */
export function createPublicClient() {
  const env = publicEnv();
  return createSupabaseClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
