import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { CPR_IMAGE_BUCKET } from "@/lib/cpr-image";
import type { Status } from "@/lib/donor-filters";
import { formatDateTime, formatSlot, shortRef } from "@/lib/format";
import { en } from "@/lib/i18n/dictionaries/en";
import { ageOn } from "@/lib/screening";
import { donorIdSchema } from "@/lib/validation";
import { AdminShell } from "@/components/admin/AdminShell";
import { DonorActions } from "@/components/admin/DonorActions";
import { STATUS_LABELS } from "@/components/admin/StatusControl";

export const dynamic = "force-dynamic";

type Donor = {
  id: string;
  full_name: string;
  cpr: string;
  phone: string | null;
  email: string | null;
  dob: string | null;
  blood_type: string;
  slot_id: number | null;
  source: "self_signup" | "admin_added" | "walk_in";
  status: Status;
  queue_number: number | null;
  q_recent_donation: boolean | null;
  q_on_medication: boolean | null;
  flagged: boolean;
  flag_reasons: string[];
  notes: string | null;
  email_sent: boolean;
  email_attempts: number;
  email_last_error: string | null;
  created_at: string;
  cpr_image_path: string | null;
};

type HistoryRow = {
  id: number;
  kind: "created" | "status" | "edit";
  to_status: Status;
  changed_by_name: string;
  changed_at: string;
};

const SOURCE_LABEL = { self_signup: "Pre-registration (public form)", walk_in: "Walk-in", admin_added: "Staff added" };
const answer = (v: boolean | null) => (v === true ? "Yes" : v === false ? "No" : "Not asked");

export default async function DonorDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const { supabase, displayName } = await requireAdmin();
  if (!donorIdSchema.safeParse(id).success) notFound();

  const { data } = await supabase.from("donors").select("*").eq("id", id).maybeSingle();
  if (!data) notFound();
  const d = data as Donor;

  const [slotRes, historyRes, eventRes, imageRes] = await Promise.all([
    d.slot_id !== null
      ? supabase.from("slots").select("starts_at").eq("id", d.slot_id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from("donor_status_history")
      .select("id, kind, to_status, changed_by_name, changed_at")
      .eq("donor_id", id)
      .order("changed_at", { ascending: false })
      .order("id", { ascending: false }),
    supabase.from("event").select("event_date").single(),
    d.cpr_image_path
      ? supabase.storage.from(CPR_IMAGE_BUCKET).createSignedUrl(d.cpr_image_path, 600)
      : Promise.resolve(null),
  ]);
  const imageUrl = imageRes?.data?.signedUrl ?? null;
  const slotTime = (slotRes.data as { starts_at: string } | null)?.starts_at ?? null;
  const history = (historyRes.data ?? []) as HistoryRow[];
  const eventDate = (eventRes.data as { event_date: string } | null)?.event_date ?? null;
  const flagLabels = en.flags as Record<string, string>;

  const created = (Array.isArray(sp.created) ? sp.created[0] : sp.created) === "1";
  const queue = Array.isArray(sp.queue) ? sp.queue[0] : sp.queue;
  const warn = (Array.isArray(sp.warn) ? sp.warn[0] : sp.warn) === "checkin";

  const emailStatus = !d.email
    ? "None"
    : d.email_sent
      ? "Sent"
      : `Pending (${d.email_attempts} attempt${d.email_attempts === 1 ? "" : "s"}${d.email_last_error ? `, last error: ${d.email_last_error}` : ""})`;

  const rows: [string, string][] = [
    ["Full name", d.full_name],
    ["CPR", d.cpr],
    [
      "Date of birth",
      d.dob ? `${d.dob}${eventDate ? ` (age ${ageOn(d.dob, eventDate)} at the event)` : ""}` : "-",
    ],
    ["Phone", d.phone ?? "-"],
    ["Email", d.email ?? "-"],
    ["Blood type", d.blood_type === "unknown" ? "Unknown" : d.blood_type],
    ["Source", SOURCE_LABEL[d.source]],
    ["Status", STATUS_LABELS[d.status]],
    ["Queue #", d.queue_number !== null ? `#${d.queue_number}` : "-"],
    ["Slot", slotTime ? formatSlot(slotTime, "en") : "-"],
    ["Registered on", formatDateTime(d.created_at)],
    ["Ref", `#${shortRef(d.id)}`],
    ["Email status", emailStatus],
  ];

  return (
    <AdminShell displayName={displayName} wide={false}>
      <h1 className="mb-4 text-2xl font-bold" dir="auto">
        {d.full_name}
      </h1>
      {created && (
        <p role="status" className="mb-3 rounded-md bg-green-50 px-3 py-2 text-sm text-success">
          Donor saved{queue ? `, queue #${queue}` : ""}.
        </p>
      )}
      {warn && (
        <p role="alert" className="mb-3 rounded-md bg-flag-bg px-3 py-2 text-sm text-flag-ink">
          Donor saved, but check-in failed. Use the Check in button.
        </p>
      )}
      {d.flagged && (
        <p role="alert" className="mb-4 rounded-md bg-flag-bg px-3 py-2 text-sm text-flag-ink">
          Flagged for medical review: {d.flag_reasons.map((r) => flagLabels[r] ?? r).join("; ")}
        </p>
      )}
      <div className="mb-6">
        <DonorActions
          donorId={d.id}
          name={d.full_name}
          status={d.status}
          hasEmail={!!d.email}
          emailSent={d.email_sent}
        />
      </div>

      <dl className="mb-6 grid gap-x-6 gap-y-2 rounded-lg border border-line bg-white p-4 sm:grid-cols-2">
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt className="text-xs text-ink-soft">{k}</dt>
            <dd className="text-sm" dir="auto">
              {v}
            </dd>
          </div>
        ))}
      </dl>

      <section className="mb-6 rounded-lg border border-line bg-white p-4">
        <h2 className="mb-2 font-bold">CPR card photo</h2>
        {!d.cpr_image_path ? (
          <p className="text-sm text-ink-soft">No photo uploaded.</p>
        ) : imageUrl ? (
          <a href={imageUrl} target="_blank" rel="noopener noreferrer">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={imageUrl} alt="CPR card photo" className="max-h-72 rounded border border-line" />
          </a>
        ) : (
          <p className="text-sm text-crimson">Could not load the photo.</p>
        )}
      </section>

      <section className="mb-6 rounded-lg border border-line bg-white p-4">
        <h2 className="mb-2 font-bold">Screening answers</h2>
        <dl className="space-y-1 text-sm">
          <div className="flex justify-between gap-4">
            <dt>Donated blood in the last 3 months?</dt>
            <dd>{answer(d.q_recent_donation)}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt>Taking antibiotics or medication?</dt>
            <dd>{answer(d.q_on_medication)}</dd>
          </div>
        </dl>
      </section>

      {d.notes && (
        <section className="mb-6 rounded-lg border border-line bg-white p-4">
          <h2 className="mb-2 font-bold">Notes</h2>
          <p className="whitespace-pre-wrap text-sm" dir="auto">
            {d.notes}
          </p>
        </section>
      )}

      <section className="rounded-lg border border-line bg-white p-4">
        <h2 className="mb-2 font-bold">History</h2>
        {history.length === 0 ? (
          <p className="text-sm text-ink-soft">No history yet.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {history.map((h) => (
              <li key={h.id}>
                {h.kind === "edit"
                  ? "(details edited)"
                  : h.kind === "created"
                    ? `Created as ${STATUS_LABELS[h.to_status]}`
                    : STATUS_LABELS[h.to_status]}{" "}
                by {h.changed_by_name} <span className="text-ink-soft">{formatDateTime(h.changed_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </AdminShell>
  );
}
