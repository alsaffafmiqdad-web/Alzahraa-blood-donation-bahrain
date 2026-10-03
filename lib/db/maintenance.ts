import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/** A trivial read that keeps the Supabase project awake. */
export async function ping(): Promise<void> {
  const { error } = await createSupabaseAdminClient().from("event").select("id").limit(1);
  if (error) throw new Error(`ping failed: ${error.message}`);
}

export async function dailyMaintenance(): Promise<void> {
  const { error } = await createSupabaseAdminClient().rpc("daily_maintenance");
  if (error) throw new Error(`daily_maintenance failed: ${error.message}`);
}
