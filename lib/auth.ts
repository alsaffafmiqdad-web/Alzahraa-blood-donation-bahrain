import "server-only";
import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Every admin page and action calls this first.
 * No session: redirect to login. Signed in but not in `admins`: sign out and redirect.
 */
export async function requireAdmin(): Promise<{ supabase: SupabaseClient; userId: string; displayName: string }> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) redirect("/admin/login");
  const userId = data.user.id;
  const { data: row } = await supabase.from("admins").select("display_name").eq("user_id", userId).maybeSingle();
  if (!row) {
    await supabase.auth.signOut();
    redirect("/admin/login?error=not_admin");
  }
  return { supabase, userId, displayName: (row as { display_name: string }).display_name };
}
