import { requireAdmin } from "@/lib/auth";
import { maskCpr } from "@/lib/cpr";
import {
  filterDonors,
  parseFilters,
  sortDonors,
  withRegistrationOrder,
  type DonorRecord,
} from "@/lib/donor-filters";
import { fetchAllRows } from "@/lib/db/paginate";
import { formatDateTime, shortRef } from "@/lib/format";
import { AdminShell } from "@/components/admin/AdminShell";
import { PrintButton } from "@/components/admin/PrintButton";
import { PrintForm, type PrintDonor, type PrintEvent } from "@/components/admin/PrintForm";

export const dynamic = "force-dynamic";

type Row = DonorRecord & {
  dob: string | null;
  notes: string | null;
};

const COLUMNS =
  "id, full_name, cpr, phone, email, blood_type, slot_id, source, status, queue_number, flagged, flag_reasons, email_sent, created_at, dob, notes";

export default async function PrintListPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { supabase, displayName } = await requireAdmin();
  const filters = { ...parseFilters(await searchParams), sort: "registration" as const };

  const [donorsRes, slotsRes, eventRes] = await Promise.all([
    fetchAllRows<Row>((from, to) =>
      supabase
        .from("donors")
        .select(COLUMNS)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to),
    ),
    supabase.from("slots").select("id, starts_at"),
    supabase.from("event").select("name_ar, name_en, location_ar, location_en, event_date").single(),
  ]);
  const all = (donorsRes.data ?? []) as Row[];
  const slotTimes = new Map(((slotsRes.data ?? []) as { id: number; starts_at: string }[]).map((s) => [s.id, s.starts_at]));
  const numbered = withRegistrationOrder(all);
  const extra = new Map(all.map((r) => [r.id, r]));
  const chosen = sortDonors(filterDonors(numbered, filters), "registration", slotTimes);
  const event = eventRes.data as PrintEvent | null;
  const printedOn = formatDateTime(new Date().toISOString());

  return (
    <AdminShell displayName={displayName}>
      <div className="no-print mb-4 flex items-center gap-4">
        <PrintButton />
        <span className="text-sm text-ink-soft">{chosen.length} donor forms, one per page</span>
      </div>
      {!event || chosen.length === 0 ? (
        <p className="rounded-lg border border-line bg-white p-6 text-center text-ink-soft">
          No donors match the current search or filter.
        </p>
      ) : (
        chosen.map((r) => {
          const x = extra.get(r.id);
          const donor: PrintDonor = {
            ref: shortRef(r.id),
            fullName: r.full_name,
            cprMasked: maskCpr(r.cpr),
            dob: x?.dob ?? null,
            phone: r.phone,
            email: r.email,
            bloodType: r.blood_type,
            slotTime: r.slot_id === null ? null : (slotTimes.get(r.slot_id) ?? null),
            createdAt: r.created_at,
            source: r.source,
            queueNumber: r.queue_number,
            flagged: r.flagged,
            flagReasons: r.flag_reasons,
            notes: x?.notes ?? null,
          };
          return <PrintForm key={r.id} donor={donor} event={event} printedOn={printedOn} />;
        })
      )}
    </AdminShell>
  );
}
