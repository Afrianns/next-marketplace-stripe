import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getSupabaseEnv } from "@/utils/supabase/env";
import type { Database } from "@/utils/supabase/database.types";

export function createAdminClient() {
  const { url } = getSupabaseEnv();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!serviceRoleKey) {
    throw new Error("Set SUPABASE_SERVICE_ROLE_KEY on the server.");
  }

  return createSupabaseClient<Database>(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
