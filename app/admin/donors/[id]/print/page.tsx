import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { formatDateShort, shortRef } from "@/lib/format";
import { donorIdSchema } from "@/lib/validation";
import { AdminShell } from "@/components/admin/AdminShell";
import { AutoPrint } from "@/components/admin/AutoPrint";
import { PrintButton } from "@/components/admin/PrintButton";
import { PrintForm, type PrintDonor, type PrintEvent } from "@/components/admin/PrintForm";

export const dynamic = "force-dynamic";

export default async function PrintDonorPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const { supabase, displayName } = await requireAdmin();
  const autoPrint = (await searchParams)?.autoprint === "1";
  if (!donorIdSchema.safeParse(id).success) notFound();

  const { data } = await supabase
    .from("donors")
    .select(
      "id, full_name, cpr, dob, phone, email, blood_type, slot_id, created_at, source, queue_number, flagged, flag_reasons, notes",
    )
    .eq("id", id)
    .maybeSingle();
  if (!data) notFound();
  const d = data as {
    id: string;
    full_name: string;
    cpr: string;
    dob: string | null;
    phone: string | null;
    email: string | null;
    blood_type: string;
    slot_id: number | null;
    created_at: string;
    source: PrintDonor["source"];
    queue_number: number | null;
    flagged: boolean;
    flag_reasons: string[];
    notes: string | null;
  };
  const [slotRes, eventRes] = await Promise.all([
    d.slot_id !== null
      ? supabase.from("slots").select("starts_at").eq("id", d.slot_id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase.from("event").select("name_ar, name_en, location_ar, location_en, event_date").single(),
  ]);
  if (!eventRes.data) notFound();

  const donor: PrintDonor = {
    ref: shortRef(d.id),
    fullName: d.full_name,
    cpr: d.cpr,
    dob: d.dob,
    phone: d.phone,
    email: d.email,
    bloodType: d.blood_type,
    slotTime: (slotRes.data as { starts_at: string } | null)?.starts_at ?? null,
    createdAt: d.created_at,
    source: d.source,
    queueNumber: d.queue_number,
    flagged: d.flagged,
    flagReasons: d.flag_reasons,
    notes: d.notes,
  };

  return (
    <AdminShell displayName={displayName}>
      <div className="no-print mb-4">
        <PrintButton />
      </div>
      {autoPrint && <AutoPrint />}
      <PrintForm donor={donor} event={eventRes.data as PrintEvent} printedOn={formatDateShort(new Date().toISOString())} />
    </AdminShell>
  );
}
