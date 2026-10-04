import { formatDateShort, formatSlot } from "@/lib/format";
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

const SOURCE = { self_signup: "Pre-registered", walk_in: "Walk-in", admin_added: "Staff added" } as const;
const STAFF_BOXES = ["HAEMOGLOBIN", "BLOOD PRESSURE", "PULSE", "WEIGHT", "BAG / UNIT NO.", "NOTES"];

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-1.5 mt-2.5 border-b border-[#ddd] pb-1 text-xs font-bold uppercase tracking-[.5px] text-crimson-dark">
      {children}
    </div>
  );
}

export function PrintForm({ donor, event, printedOn }: { donor: PrintDonor; event: PrintEvent; printedOn: string }) {
  const flagLabels = en.flags as Record<string, string>;
  const strong = "text-base font-extrabold text-[#111]";
  const cells: { label: string; value: string; strong?: boolean; auto?: boolean }[] = [
    { label: "Full name", value: donor.fullName, strong: true, auto: true },
    { label: "CPR number", value: donor.cpr, strong: true },
    { label: "Date of birth", value: donor.dob ? formatDateShort(donor.dob) : "-" },
    { label: "Slot", value: donor.slotTime ? formatSlot(donor.slotTime, "en") : "-" },
    { label: "Mobile", value: donor.phone ?? "-" },
    { label: "Email", value: donor.email ?? "-" },
    { label: "Blood type", value: donor.bloodType === "unknown" ? "Unknown" : donor.bloodType },
    { label: "Registered on", value: formatDateShort(donor.createdAt) },
  ];
  return (
    <section className="print-page mx-auto max-w-[190mm] bg-white p-6 text-[#1a1a1a]">
      <div className="mb-4 flex items-start justify-between border-b-[3px] border-crimson pb-3">
        <div>
          <h2 className="mb-1 font-heading text-[22px]" dir="auto">
            {event.name_ar}
          </h2>
          <div className="text-[13px] text-[#555]">
            {formatDateShort(event.event_date)}
            {event.location_ar && (
              <>
                {" | "}
                <span dir="auto">{event.location_ar}</span>
              </>
            )}
          </div>
          <div className="text-[13px] text-[#555]">Donor Registration Form</div>
        </div>
        <div className="text-end text-[13px]">
          Donor ID
          <b className="block font-heading text-lg text-crimson">#{donor.ref}</b>
          {SOURCE[donor.source]}
          {donor.queueNumber !== null && (
            <div className="mt-1 text-xl font-extrabold text-crimson">Queue #{donor.queueNumber}</div>
          )}
        </div>
      </div>

      {donor.flagged && (
        <div className="my-2.5 rounded-md bg-flag-bg px-3 py-2 text-xs font-bold uppercase tracking-[.4px] text-flag-ink">
          Flagged for medical review: {donor.flagReasons.map((r) => flagLabels[r] ?? r).join("; ")}
        </div>
      )}

      <SectionTitle>Donor details</SectionTitle>
      <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
        {cells.map((c) => (
          <div key={c.label} className="border-b border-dotted border-[#ccc] py-1">
            <b className="block text-[11px] font-semibold uppercase text-[#777]">{c.label}</b>
            <span className={c.strong ? strong : undefined} dir={c.auto ? "auto" : undefined}>
              {c.value}
            </span>
          </div>
        ))}
      </div>

      {donor.notes && (
        <p className="mt-2 whitespace-pre-wrap text-xs" dir="auto">
          <b>Notes:</b> {donor.notes}
        </p>
      )}

      <SectionTitle>For staff use</SectionTitle>
      <div className="mt-1.5 grid grid-cols-3 gap-3.5 text-[13px]">
        {STAFF_BOXES.map((b) => (
          <div key={b} className="border-b border-[#999] pb-3">
            <b className="text-[10px] text-[#777]">{b}</b>
          </div>
        ))}
      </div>

      <div className="mt-[22px] flex justify-between text-[13px]">
        <div className="w-[45%] border-t border-[#333] pt-1.5">Donor signature</div>
        <div className="w-[45%] border-t border-[#333] pt-1.5">Staff signature</div>
      </div>
      <div className="mt-3 text-center text-[11px] text-[#999]">Printed on {printedOn} | Donor Registry</div>
    </section>
  );
}
