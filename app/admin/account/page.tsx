import { requireAdmin } from "@/lib/auth";
import { listAdmins, type AdminListItem } from "@/lib/db/admins";
import { formatDateShort } from "@/lib/format";
import { AdminShell } from "@/components/admin/AdminShell";
import { AddAdminForm } from "@/components/admin/AddAdminForm";
import { PasswordForm } from "@/components/admin/PasswordForm";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const { displayName, userId } = await requireAdmin();
  let admins: AdminListItem[] | null = null;
  try {
    admins = await listAdmins();
  } catch (e) {
    console.error(`listAdmins error: ${e instanceof Error ? e.message : "unknown"}`);
  }
  return (
    <AdminShell displayName={displayName} wide={false}>
      <h1 className="mb-4 text-2xl font-bold">Settings</h1>

      <section className="mb-8">
        <h2 className="mb-3 text-lg font-bold">Change password</h2>
        <PasswordForm />
      </section>

      <section>
        <h2 className="mb-3 text-lg font-bold">Admins</h2>
        {admins === null ? (
          <p className="mb-4 text-sm text-crimson">Could not load the admin list.</p>
        ) : (
          <ul className="mb-6 divide-y divide-line rounded-lg border border-line bg-white text-sm">
            {admins.map((a) => (
              <li key={a.userId} className="flex flex-wrap items-baseline justify-between gap-2 px-3 py-2">
                <span className="font-medium" dir="auto">
                  {a.displayName}
                  {a.userId === userId ? " (you)" : ""}
                </span>
                <span className="text-ink-soft">added {formatDateShort(a.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
        <h3 className="mb-3 font-bold">Add an admin</h3>
        <AddAdminForm />
      </section>
    </AdminShell>
  );
}
