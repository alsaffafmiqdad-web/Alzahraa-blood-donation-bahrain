import { requireAdmin } from "@/lib/auth";
import { fetchAllRows } from "@/lib/db/paginate";
import { AdminShell } from "@/components/admin/AdminShell";
import { SlotsManager, type SlotRow } from "@/components/admin/SlotsManager";

export const dynamic = "force-dynamic";

export default async function SlotsPage() {
  const { supabase, displayName } = await requireAdmin();
  const [slotsRes, donorsRes] = await Promise.all([
    supabase.from("slots").select("id, starts_at, capacity, active").order("starts_at"),
    fetchAllRows<{ slot_id: number; status: string }>((from, to) =>
      supabase
        .from("donors")
        .select("slot_id, status")
        .not("slot_id", "is", null)
        .order("id", { ascending: true })
        .range(from, to),
    ),
  ]);
  const donors = (donorsRes.data ?? []) as { slot_id: number; status: string }[];
  const rows: SlotRow[] = ((slotsRes.data ?? []) as { id: number; starts_at: string; capacity: number; active: boolean }[]).map(
    (s) => {
      const mine = donors.filter((d) => d.slot_id === s.id);
      return {
        id: s.id,
        startsAt: s.starts_at,
        capacity: s.capacity,
        active: s.active,
        booked: mine.length,
        checkedIn: mine.filter((d) => d.status !== "registered" && d.status !== "verified").length,
        donated: mine.filter((d) => d.status === "donated").length,
      };
    },
  );
  return (
    <AdminShell displayName={displayName}>
      <h1 className="mb-4 text-2xl font-bold">Slots</h1>
      <p className="mb-4 text-sm text-ink-soft">
        The public form hides inactive slots and disables full ones. Staff adds can exceed capacity.
      </p>
      <SlotsManager slots={rows} />
    </AdminShell>
  );
}
