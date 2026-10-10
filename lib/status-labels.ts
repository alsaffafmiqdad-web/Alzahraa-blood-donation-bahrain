import type { Status } from "@/lib/donor-filters";

/* Isomorphic and pure. The admin-managed display name of each status. */

export type StatusLabels = Record<Status, string>;
export const STATUS_LABEL_MAX = 40;
/** An en dash (U+2013) or em dash (U+2014); built from code points so this file holds neither character. */
export const LONG_DASH_RE = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`);

/** Seed values. Used ONLY by resolveStatusLabels as the fallback for a missing or invalid row. Never import this in UI code. */
export const DEFAULT_STATUS_LABELS: StatusLabels = {
  registered: "Registered",
  verified: "Verified (before the event)",
  waiting: "Registration Station",
  screening: "Doctor Station",
  donated: "Donation Reception",
  deferred: "Deferred",
  no_show: "No show (after half time)",
};

export function isValidStatusLabel(v: unknown): v is string {
  return (
    typeof v === "string" &&
    v.length >= 1 &&
    v.length <= STATUS_LABEL_MAX &&
    v === v.trim() &&
    !LONG_DASH_RE.test(v)
  );
}

/** One status name for output (the CSV): the given label, else the seed name, else the raw key for an unknown status. */
export function statusLabelFor(labels: Partial<Record<string, string>>, status: string): string {
  return labels[status] ?? (Object.hasOwn(DEFAULT_STATUS_LABELS, status) ? DEFAULT_STATUS_LABELS[status as Status] : status);
}

/** Rows from the DB to a complete map: unknown statuses are ignored; a missing or invalid label falls back to the default for that key. */
export function resolveStatusLabels(rows: { status: string; label: string }[] | null | undefined): StatusLabels {
  const out: StatusLabels = { ...DEFAULT_STATUS_LABELS };
  for (const row of rows ?? []) {
    if (Object.hasOwn(DEFAULT_STATUS_LABELS, row.status) && isValidStatusLabel(row.label)) {
      out[row.status as Status] = row.label;
    }
  }
  return out;
}
