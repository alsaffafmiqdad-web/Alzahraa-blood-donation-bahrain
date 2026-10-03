import { requireAdmin } from "@/lib/auth";
import { AdminShell } from "@/components/admin/AdminShell";
import { DonorForm, type SlotChoice } from "@/components/admin/DonorForm";

export const dynamic = "force-dynamic";

export default async function NewDonorPage() {
  const { supabase, displayName } = await requireAdmin();
  const { data } = await supabase.from("slots").select("id, starts_at").eq("active", true).order("starts_at");
  return (
    <AdminShell displayName={displayName} wide={false}>
      <h1 className="mb-4 text-2xl font-bold">Add donor</h1>
      <DonorForm mode="add" slots={(data ?? []) as SlotChoice[]} />
    </AdminShell>
  );
}
