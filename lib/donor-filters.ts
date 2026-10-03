import { STATUSES } from "@/lib/config";
import { normaliseDigits } from "@/lib/cpr";
import { shortRef } from "@/lib/format";

export type Status = (typeof STATUSES)[number];
export type Source = "self_signup" | "admin_added" | "walk_in";

/** Row as selected for the dashboard. Contains the full CPR: it must be mapped with toListRow before reaching a client component. */
export type DonorRecord = {
  id: string;
  full_name: string;
  cpr: string;
  phone: string | null;
  email: string | null;
  blood_type: string;
  slot_id: number | null;
  source: Source;
  status: Status;
  queue_number: number | null;
  flagged: boolean;
  flag_reasons: string[];
  email_sent: boolean;
  created_at: string;
};

export type DonorListRow = {
  id: string;
  seq: number;
  ref: string;
  fullName: string;
  cpr: string;
  phone: string | null;
  email: string | null;
  bloodType: string;
  slotId: number | null;
  slotTime: string | null;
  source: Source;
  status: Status;
  queueNumber: number | null;
  flagged: boolean;
  flagReasons: string[];
  emailSent: boolean;
  createdAt: string;
};

export type SortKey = "registration" | "slot" | "queue";

export type DonorFilters = {
  q?: string;
  status?: string;
  flagged?: boolean;
  slot?: string; // slot id or "none"
  source?: string;
  sort?: SortKey;
};

export type SlotTimes = ReadonlyMap<number, string>;

export type NumberedDonor = DonorRecord & { seq: number };

/** Registration order is by created_at ascending (ties by id); seq is 1-based over ALL donors, before filtering. */
export function withRegistrationOrder(rows: DonorRecord[]): NumberedDonor[] {
  return [...rows]
    .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))
    .map((r, i) => ({ ...r, seq: i + 1 }));
}

export function filterDonors(rows: NumberedDonor[], f: DonorFilters): NumberedDonor[] {
  const q = (f.q ?? "").trim().toLowerCase();
  const qDigits = normaliseDigits(q);
  const qRef = q.replace(/^#/, "").toUpperCase();
  return rows.filter((r) => {
    if (q) {
      const hit =
        r.full_name.toLowerCase().includes(q) ||
        (qDigits !== "" && r.cpr.includes(qDigits)) ||
        (qDigits !== "" && (r.phone ?? "").includes(qDigits)) ||
        (qRef.length >= 3 && shortRef(r.id).includes(qRef));
      if (!hit) return false;
    }
    if (f.status && f.status !== "all" && r.status !== f.status) return false;
    if (f.flagged && !r.flagged) return false;
    if (f.slot) {
      if (f.slot === "none") {
        if (r.slot_id !== null) return false;
      } else if (String(r.slot_id) !== f.slot) return false;
    }
    if (f.source && f.source !== "all" && r.source !== f.source) return false;
    return true;
  });
}

function cmpNullsLast(a: number | string | null, b: number | string | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a < b ? -1 : a > b ? 1 : 0;
}

export function sortDonors(rows: NumberedDonor[], sort: SortKey, slots: SlotTimes): NumberedDonor[] {
  const out = [...rows];
  out.sort((a, b) => {
    if (sort === "slot") {
      const c = cmpNullsLast(
        a.slot_id === null ? null : (slots.get(a.slot_id) ?? null),
        b.slot_id === null ? null : (slots.get(b.slot_id) ?? null),
      );
      if (c !== 0) return c;
    } else if (sort === "queue") {
      const c = cmpNullsLast(a.queue_number, b.queue_number);
      if (c !== 0) return c;
    }
    return a.seq - b.seq;
  });
  return out;
}

export type DonorStats = {
  total: number;
  byStatus: Record<Status, number>;
  flagged: number;
  walkIns: number;
  emailsPending: number;
};

export function computeStats(rows: DonorRecord[]): DonorStats {
  const byStatus = Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<Status, number>;
  let flagged = 0;
  let walkIns = 0;
  let emailsPending = 0;
  for (const r of rows) {
    byStatus[r.status] += 1;
    if (r.flagged) flagged += 1;
    if (r.source === "walk_in") walkIns += 1;
    if (r.email && !r.email_sent) emailsPending += 1;
  }
  return { total: rows.length, byStatus, flagged, walkIns, emailsPending };
}

/** Maps to the row sent to the admin dashboard (admins see the full CPR). */
export function toListRow(r: NumberedDonor, slots: SlotTimes): DonorListRow {
  return {
    id: r.id,
    seq: r.seq,
    ref: shortRef(r.id),
    fullName: r.full_name,
    cpr: r.cpr,
    phone: r.phone,
    email: r.email,
    bloodType: r.blood_type,
    slotId: r.slot_id,
    slotTime: r.slot_id === null ? null : (slots.get(r.slot_id) ?? null),
    source: r.source,
    status: r.status,
    queueNumber: r.queue_number,
    flagged: r.flagged,
    flagReasons: r.flag_reasons,
    emailSent: r.email_sent,
    createdAt: r.created_at,
  };
}

/** Parse dashboard searchParams into filters (unknown values are ignored). */
/**
 * A full 9 digit CPR must never go into a URL (browser history, Vercel request logs), so a search term
 * that is a CPR is reduced to its last 4 digits. The dashboard then matches those 4 digits.
 */
export function urlSafeSearch(q: string): string {
  const digits = normaliseDigits(q.trim());
  return /^[0-9]{9}$/.test(digits) ? digits.slice(-4) : q;
}

export function parseFilters(sp: Record<string, string | string[] | undefined>): DonorFilters {
  const one = (k: string): string | undefined => {
    const v = sp[k];
    return Array.isArray(v) ? v[0] : v;
  };
  const sortRaw = one("sort");
  const sort: SortKey = sortRaw === "slot" || sortRaw === "queue" ? sortRaw : "registration";
  const status = one("status");
  const source = one("source");
  const slot = one("slot");
  return {
    q: one("q")?.slice(0, 100) || undefined,
    status: status && (status === "all" || (STATUSES as readonly string[]).includes(status)) ? status : undefined,
    flagged: one("flagged") === "1" ? true : undefined,
    slot: slot && (slot === "none" || /^\d{1,5}$/.test(slot)) ? slot : undefined,
    source:
      source && (source === "all" || ["self_signup", "admin_added", "walk_in"].includes(source))
        ? source
        : undefined,
    sort,
  };
}
