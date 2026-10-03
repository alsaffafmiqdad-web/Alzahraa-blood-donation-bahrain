import { formatDateTime, formatSlot } from "@/lib/format";
import { en } from "@/lib/i18n/dictionaries/en";

export type PrintDonor = {
  ref: string;
  fullName: string;
  cpr: string;
  dob: string | null;
  phone: string | null;
  email: string | null;
  bloodType: string;
  slotTime: string | null;
  createdAt: string;
  source: "self_signup" | "admin_added" | "walk_in";
  queueNumber: number | null;
  flagged: boolean;
  flagReasons: string[];
  notes: string | null;
};

export type PrintEvent = {
  name_ar: string;
  name_en: string;
  location_en: string;
  location_ar: string;
  event_date: string;
};

const SOURCE = { self_signup: "Pre-registration", walk_in: "Walk-in", admin_added: "Staff added" } as const;
const STAFF_BOXES = ["HAEMOGLOBIN", "BLOOD PRESSURE", "PULSE", "WEIGHT", "BAG / UNIT NO.", "NOTES"];

export function PrintForm({ donor, event, printedOn }: { donor: PrintDonor; event: PrintEvent; printedOn: string }) {
  const flagLabels = en.flags as Record<string, string>;
  const details: [string, string][] = [
    ["Name", donor.fullName],
    ["CPR", donor.cpr],
    ["Date of birth", donor.dob ?? "-"],
    ["Phone", donor.phone ?? "-"],
    ["Email", donor.email ?? "-"],
    ["Blood type", donor.bloodType === "unknown" ? "Unknown" : donor.bloodType],
    ["Slot", donor.slotTime ? formatSlot(donor.slotTime, "en") : "-"],
    ["Registered on", formatDateTime(donor.createdAt)],
  ];
  return (
    <section className="print-page mx-auto max-w-[190mm] bg-white p-6 text-sm text-black">
      <header className="mb-4 flex items-start justify-between gap-4 border-b-2 border-crimson pb-3">
        <div>
          <h1 className="text-lg font-bold">{event.name_en}</h1>
          <p dir="rtl" lang="ar" className="text-base">
            {event.name_ar}
          </p>
          <p className="text-xs text-ink-soft">
            {event.event_date} | {event.location_en}
          </p>
          <p className="mt-1 font-bold">Donor Registration Form</p>
        </div>
        <div className="text-end">
          <p className="font-mono text-base font-bold">#{donor.ref}</p>
          <p className="text-xs">{SOURCE[donor.source]}</p>
          {donor.queueNumber !== null && (
            <p className="text-3xl font-bold text-crimson">Queue #{donor.queueNumber}</p>
          )}
        </div>
      </header>

      {donor.flagged && (
        <p className="mb-3 rounded border border-flag-ink bg-flag-bg px-3 py-1.5 font-medium text-flag-ink">
          Flagged for medical review: {donor.flagReasons.map((r) => flagLabels[r] ?? r).join("; ")}
        </p>
      )}

      <dl className="mb-3 grid grid-cols-2 gap-x-6 gap-y-1">
        {details.map(([k, v]) => (
          <div key={k} className="flex gap-2 border-b border-line py-1">
            <dt className="w-28 shrink-0 text-xs uppercase text-ink-soft">{k}</dt>
            <dd dir="auto" className="font-medium">
              {v}
            </dd>
          </div>
        ))}
      </dl>

      {donor.notes && (
        <p className="mb-3 whitespace-pre-wrap rounded border border-line p-2" dir="auto">
          <span className="text-xs uppercase text-ink-soft">Notes: </span>
          {donor.notes}
        </p>
      )}

      <h2 className="mb-1 mt-4 text-xs font-bold uppercase tracking-wide">For staff use</h2>
      <div className="mb-8 grid grid-cols-3 gap-2">
        {STAFF_BOXES.map((b) => (
          <div key={b} className="h-16 rounded border border-black p-1 text-[10px] uppercase">
            {b}
          </div>
        ))}
      </div>

      <div className="mb-4 grid grid-cols-2 gap-10">
        <div className="border-t border-black pt-1 text-xs">Donor signature</div>
        <div className="border-t border-black pt-1 text-xs">Staff signature</div>
      </div>
      <p className="text-[10px] text-ink-soft">Printed on {printedOn}</p>
    </section>
  );
}
