import Link from "next/link";
import { searchDonors } from "@/app/admin/actions";
import { requireAdmin } from "@/lib/auth";
import { STATUSES } from "@/lib/config";
import {
  computeStats,
  filterDonors,
  parseFilters,
  sortDonors,
  toListRow,
  withRegistrationOrder,
  type DonorRecord,
} from "@/lib/donor-filters";
import { fetchAllRows } from "@/lib/db/paginate";
import { getStatusLabels } from "@/lib/db/status-labels";
import { formatSlot } from "@/lib/format";
import { AdminShell } from "@/components/admin/AdminShell";
import { AutoRefresh } from "@/components/admin/AutoRefresh";
import { DonorTable } from "@/components/admin/DonorTable";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

const COLUMNS =
  "id, full_name, cpr, phone, email, blood_type, slot_id, source, status, queue_number, flagged, flag_reasons, email_sent, created_at";

const inputCls = "rounded-md border border-line bg-white px-2 py-1.5 text-sm";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { supabase, displayName } = await requireAdmin();
  const sp = await searchParams;
  const filters = parseFilters(sp);
  const labels = await getStatusLabels(supabase);

  const [donorsRes, slotsRes] = await Promise.all([
    fetchAllRows<DonorRecord>((from, to) =>
      supabase
        .from("donors")
        .select(COLUMNS)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to),
    ),
    supabase.from("slots").select("id, starts_at").order("starts_at", { ascending: true }),
  ]);
  const donors = (donorsRes.data ?? []) as DonorRecord[];
  const slotList = (slotsRes.data ?? []) as { id: number; starts_at: string }[];
  const slotTimes = new Map(slotList.map((s) => [s.id, s.starts_at]));

  const numbered = withRegistrationOrder(donors);
  const rows = sortDonors(filterDonors(numbered, filters), filters.sort ?? "registration", slotTimes).map((r) =>
    toListRow(r, slotTimes),
  );
  const stats = computeStats(donors);
  const inProgress = stats.byStatus.verified + stats.byStatus.waiting + stats.byStatus.screening;

  const printParams = new URLSearchParams();
  for (const key of ["q", "status", "flagged", "slot", "source", "sort"] as const) {
    const v = filters[key];
    if (v !== undefined && v !== false) printParams.set(key, v === true ? "1" : String(v));
  }
  const qs = printParams.toString();

  return (
    <AdminShell displayName={displayName}>
      {donorsRes.error && (
        <p role="alert" className="mb-4 rounded-md bg-danger-tint px-3 py-2 text-sm text-danger-dark">
          Could not load donors: {donorsRes.error.message}
        </p>
      )}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Total donors" value={stats.total} />
        <Stat label={labels.donated} value={stats.byStatus.donated} />
        <Stat label="In progress" value={inProgress} hint={`${labels.verified}, ${labels.waiting} or ${labels.screening}`} />
        <Stat label="Flagged" value={stats.flagged} />
        {stats.emailsPending > 0 && <Stat label="Emails pending" value={stats.emailsPending} />}
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          <Button asChild>
            <Link href="/admin/donors/new">Add donor</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={`/admin/print${qs ? `?${qs}` : ""}`}>Print list</Link>
          </Button>
          <Button asChild variant="outline">
            <a href="/admin/export">Export CSV</a>
          </Button>
        </div>
        <AutoRefresh />
      </div>

      <form action={searchDonors} className="mb-4 flex flex-wrap items-end gap-3 rounded-lg border border-line bg-white p-3">
        <label className="flex flex-col gap-1 text-xs text-ink-soft">
          Search
          <input name="q" defaultValue={filters.q ?? ""} placeholder="Name, CPR (last 4), phone or ref" className={inputCls + " w-56"} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-soft">
          Status
          <select name="status" defaultValue={filters.status ?? "all"} className={inputCls}>
            <option value="all">All</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {labels[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-soft">
          Slot
          <select name="slot" defaultValue={filters.slot ?? ""} className={inputCls}>
            <option value="">All</option>
            <option value="none">No slot</option>
            {slotList.map((s) => (
              <option key={s.id} value={s.id}>
                {formatSlot(s.starts_at, "en")}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-soft">
          Source
          <select name="source" defaultValue={filters.source ?? "all"} className={inputCls}>
            <option value="all">All</option>
            <option value="self_signup">Pre-reg</option>
            <option value="walk_in">Walk-in</option>
            <option value="admin_added">Staff added</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-soft">
          Sort
          <select name="sort" defaultValue={filters.sort ?? "registration"} className={inputCls}>
            <option value="registration">Registration order</option>
            <option value="slot">Slot</option>
            <option value="queue">Queue number</option>
          </select>
        </label>
        <label className="flex items-center gap-2 pb-1.5 text-sm">
          <input type="checkbox" name="flagged" value="1" defaultChecked={!!filters.flagged} className="size-4 accent-brand" />
          Flagged only
        </label>
        <Button type="submit" size="sm">
          Apply
        </Button>
        <Button asChild type="button" size="sm" variant="ghost">
          <Link href="/admin">Reset</Link>
        </Button>
      </form>

      <p className="mb-2 text-sm text-ink-soft">
        Showing {rows.length} of {stats.total}
      </p>
      <DonorTable rows={rows} totalCount={stats.total} labels={labels} />
    </AdminShell>
  );
}

function Stat({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div className="rounded-lg border border-line bg-white px-4 py-3" title={hint}>
      <div className="text-sm font-medium text-ink">{label}</div>
      <div className="text-2xl font-bold text-ink">{value}</div>
      {hint && <div className="text-xs text-ink-soft">{hint}</div>}
    </div>
  );
}
