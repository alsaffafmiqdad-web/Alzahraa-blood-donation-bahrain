import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export type AdminListItem = { userId: string; displayName: string; createdAt: string };

export async function listAdmins(): Promise<AdminListItem[]> {
  const { data, error } = await createSupabaseAdminClient()
    .from("admins")
    .select("user_id, display_name, created_at")
    .order("created_at");
  if (error) throw new Error(`listAdmins failed: ${error.message}`);
  return ((data ?? []) as { user_id: string; display_name: string; created_at: string }[]).map((r) => ({
    userId: r.user_id,
    displayName: r.display_name,
    createdAt: r.created_at,
  }));
}

export type CreateAdminResult = { ok: true } | { ok: false; reason: "email_exists" | "failed" };

/**
 * Creates a confirmed auth user and its `admins` row. Call only after `requireAdmin()`.
 * An existing auth user is never promoted. If the `admins` insert fails the auth user is deleted again.
 */
export async function createAdmin(input: {
  email: string;
  password: string;
  displayName: string;
}): Promise<CreateAdminResult> {
  const client = createSupabaseAdminClient();
  const { data, error } = await client.auth.admin.createUser({
    email: input.email,
    password: input.password,
    email_confirm: true,
  });
  if (error || !data?.user) {
    const code = (error as { code?: string } | null)?.code;
    const message = error?.message ?? "no user returned";
    if (code === "email_exists" || /already been registered|already exists/i.test(message)) {
      return { ok: false, reason: "email_exists" };
    }
    console.error(`createAdmin: auth error: ${message}`);
    return { ok: false, reason: "failed" };
  }
  const userId = data.user.id;
  const { error: insertError } = await client
    .from("admins")
    .insert({ user_id: userId, display_name: input.displayName });
  if (insertError) {
    const { error: deleteError } = await client.auth.admin.deleteUser(userId);
    console.error(
      `createAdmin: admins insert failed: ${insertError.message}` +
        (deleteError ? `; rollback deleteUser failed: ${deleteError.message}` : ""),
    );
    return { ok: false, reason: "failed" };
  }
  return { ok: true };
}
