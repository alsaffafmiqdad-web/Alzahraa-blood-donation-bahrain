// Creates an admin for LOCAL development only.
//   pnpm admin:local <email> <password> [display name]
// Creates the user through the local Supabase Auth admin API (already confirmed) and inserts it into
// public.admins. Refuses to run unless the Supabase URL is localhost or 127.0.0.1, so it can never
// create users in a hosted project.
import { createClient } from "@supabase/supabase-js";

export function isLocalUrl(raw) {
  try {
    const { hostname } = new URL(raw);
    return hostname === "localhost" || hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

async function main() {
  const [email, password, ...rest] = process.argv.slice(2);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

  if (!isLocalUrl(url)) {
    console.error(
      `Refusing to run: NEXT_PUBLIC_SUPABASE_URL (${url || "not set"}) is not localhost or 127.0.0.1.\n` +
        "This script is for the local Supabase CLI stack only. Create real admins in the Supabase dashboard.",
    );
    process.exit(1);
  }
  if (!email || !password) {
    console.error("Usage: pnpm admin:local <email> <password> [display name]");
    process.exit(1);
  }
  if (password.length < 12) {
    console.error("The password must be at least 12 characters (the same rule as /admin/account).");
    process.exit(1);
  }
  if (!key) {
    console.error("SUPABASE_SERVICE_ROLE_KEY is not set. Copy it from `supabase status` into .env.local.");
    process.exit(1);
  }
  const displayName = (rest.join(" ").trim() || email.split("@")[0]).slice(0, 60);

  const db = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data, error } = await db.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) {
    console.error(`Could not create the user: ${error?.message ?? "no user returned"}`);
    process.exit(1);
  }
  const { error: insertError } = await db
    .from("admins")
    .insert({ user_id: data.user.id, display_name: displayName });
  if (insertError) {
    console.error(`User created but adding it to admins failed: ${insertError.message}`);
    process.exit(1);
  }
  console.log(`Local admin ready: ${email} (display name "${displayName}"). Sign in at http://localhost:3000/admin/login`);
}

// Only run when executed directly, so the guard can be imported by tests.
if (process.argv[1]?.endsWith("create-local-admin.mjs")) await main();
