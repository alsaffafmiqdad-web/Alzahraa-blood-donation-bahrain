import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { donorIdSchema } from "@/lib/validation";
import { AdminShell } from "@/components/admin/AdminShell";
import { DonorForm, type SlotChoice } from "@/components/admin/DonorForm";

export const dynamic = "force-dynamic";

export default async function EditDonorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, displayName } = await requireAdmin();
  if (!donorIdSchema.safeParse(id).success) notFound();
  const [{ data: donor }, { data: slots }] = await Promise.all([
    supabase
      .from("donors")
      .select("id, full_name, cpr, phone, email, dob, blood_type, slot_id, q_recent_donation, q_on_medication, notes")
      .eq("id", id)
      .maybeSingle(),
    supabase.from("slots").select("id, starts_at").order("starts_at"),
  ]);
  if (!donor) notFound();
  const d = donor as {
    id: string;
    full_name: string;
    cpr: string;
    phone: string | null;
    email: string | null;
    dob: string | null;
    blood_type: string;
    slot_id: number | null;
    q_recent_donation: boolean | null;
    q_on_medication: boolean | null;
    notes: string | null;
  };
  return (
    <AdminShell displayName={displayName} wide={false}>
      <h1 className="mb-4 text-2xl font-bold">Edit donor</h1>
      <DonorForm
        mode="edit"
        slots={(slots ?? []) as SlotChoice[]}
        defaults={{
          id: d.id,
          fullName: d.full_name,
          cpr: d.cpr,
          phone: d.phone ?? "",
          email: d.email ?? "",
          dob: d.dob ?? "",
          bloodType: d.blood_type,
          slotId: d.slot_id,
          recentDonation: d.q_recent_donation,
          onMedication: d.q_on_medication,
          notes: d.notes ?? "",
        }}
      />
    </AdminShell>
  );
}
