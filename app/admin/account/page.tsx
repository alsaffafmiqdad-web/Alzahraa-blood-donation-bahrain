import { requireAdmin } from "@/lib/auth";
import { AdminShell } from "@/components/admin/AdminShell";
import { PasswordForm } from "@/components/admin/PasswordForm";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const { displayName } = await requireAdmin();
  return (
    <AdminShell displayName={displayName} wide={false}>
      <h1 className="mb-4 text-2xl font-bold">Account</h1>
      <PasswordForm />
    </AdminShell>
  );
}
