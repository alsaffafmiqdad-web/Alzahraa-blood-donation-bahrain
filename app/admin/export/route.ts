import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { fetchAllRows } from "@/lib/db/paginate";
import { toCsv, type CsvCell } from "@/lib/csv";
import { shortRef, todayInBahrain } from "@/lib/format";
import { en } from "@/lib/i18n/dictionaries/en";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEADERS = [
  "#",
  "Ref",
  "Full name",
  "CPR",
  "Phone",
  "Email",
  "DOB",
  "Blood type",
  "Source",
  "Slot",
  "Status",
  "Queue number",
  "Checked in at",
  "Flagged",
  "Flag reasons",
  "Recent donation",
  "On medication",
  "Notes",
  "Email sent",
  "Registered at",
];

type Row = {
  id: string;
  full_name: string;
  cpr: string;
  phone: string | null;
  email: string | null;
  dob: string | null;
  blood_type: string;
  source: string;
  status: string;
  queue_number: number | null;
  checked_in_at: string | null;
  flagged: boolean;
  flag_reasons: string[];
  q_recent_donation: boolean | null;
  q_on_medication: boolean | null;
  notes: string | null;
  email_sent: boolean;
  created_at: string;
  slots: { starts_at: string } | null;
};

const yn = (v: boolean | null): string => (v === true ? "Yes" : v === false ? "No" : "");

export async function GET() {
  let supabase;
  try {
    ({ supabase } = await requireAdmin());
  } catch {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const { data, error } = await fetchAllRows<Row>((from, to) =>
    supabase
      .from("donors")
      .select("*, slots(starts_at)")
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to),
  );
  if (error) {
    console.error(`export failed: ${error.message}`);
    return NextResponse.json({ ok: false, error: "export_failed" }, { status: 500 });
  }
  const labels = en.flags as Record<string, string>;
  const rows: CsvCell[][] = data.map((r, i) => [
    i + 1,
    shortRef(r.id),
    r.full_name,
    r.cpr,
    r.phone,
    r.email,
    r.dob,
    r.blood_type,
    r.source,
    r.slots?.starts_at.slice(0, 5) ?? "",
    r.status,
    r.queue_number,
    r.checked_in_at,
    yn(r.flagged),
    r.flag_reasons.map((x) => labels[x] ?? x).join("; "),
    yn(r.q_recent_donation),
    yn(r.q_on_medication),
    r.notes,
    yn(r.email_sent),
    r.created_at,
  ]);
  return new NextResponse(toCsv(HEADERS, rows), {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="donors-${todayInBahrain()}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
