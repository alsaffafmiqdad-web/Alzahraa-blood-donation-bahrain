"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { addDonor, editDonor } from "@/app/admin/actions";
import { initialFormState } from "@/app/admin/action-types";
import { BLOOD_TYPES } from "@/lib/config";
import { cprInput, phoneInput } from "@/lib/cpr";
import { formatSlot } from "@/lib/format";
import { Button } from "@/components/ui/button";

export type SlotChoice = { id: number; starts_at: string };

export type DonorFormDefaults = {
  id?: string;
  fullName?: string;
  cpr?: string;
  phone?: string;
  email?: string;
  dob?: string;
  bloodType?: string;
  slotId?: number | null;
  recentDonation?: boolean | null;
  onMedication?: boolean | null;
  notes?: string;
};

const CONSENT_TEXT =
  "Staff confirm: the donor has reviewed the details above, confirmed they are accurate, and agreed to be contacted regarding this blood donation registration.";

const inputCls = "w-full rounded-md border border-line bg-white px-3 py-2 text-sm";
const labelCls = "mb-1 block text-sm font-medium";

const tri = (v: boolean | null | undefined) => (v === true ? "yes" : v === false ? "no" : "");

export function DonorForm({
  mode,
  slots,
  defaults = {},
}: {
  mode: "add" | "edit";
  slots: SlotChoice[];
  defaults?: DonorFormDefaults;
}) {
  const [state, action, pending] = useActionState(mode === "add" ? addDonor : editDonor, initialFormState);
  const [regMode, setRegMode] = useState<"walk_in" | "pre_registration">("walk_in");
  const [v, setV] = useState({
    fullName: defaults.fullName ?? "",
    cpr: defaults.cpr ?? "",
    phone: defaults.phone ?? "",
    email: defaults.email ?? "",
    dob: defaults.dob ?? "",
    bloodType: defaults.bloodType ?? "unknown",
    slotId: defaults.slotId != null ? String(defaults.slotId) : "",
    recentDonation: tri(defaults.recentDonation),
    onMedication: tri(defaults.onMedication),
    notes: defaults.notes ?? "",
  });
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setV((p) => ({ ...p, [k]: e.target.value }));
  const fe = state.fieldErrors ?? {};
  const showSlot = mode === "edit" || regMode === "pre_registration";

  return (
    <form action={action} className="space-y-5">
      {mode === "edit" && <input type="hidden" name="id" value={defaults.id} />}

      {mode === "add" && (
        <fieldset className="flex gap-6">
          <legend className="mb-1 text-sm font-medium">Registration type</legend>
          {(
            [
              ["walk_in", "Walk-in"],
              ["pre_registration", "Pre-registration"],
            ] as const
          ).map(([val, label]) => (
            <label key={val} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="mode"
                value={val}
                checked={regMode === val}
                onChange={() => setRegMode(val)}
                className="size-4 accent-crimson"
              />
              {label}
            </label>
          ))}
        </fieldset>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="fullName" className={labelCls}>
            Full name *
          </label>
          <input id="fullName" name="fullName" className={inputCls} value={v.fullName} onChange={set("fullName")} dir="auto" required />
          {fe.fullName && <p className="mt-1 text-sm text-crimson">{fe.fullName}</p>}
        </div>
        <div>
          <label htmlFor="cpr" className={labelCls}>
            CPR *
          </label>
          <input id="cpr" name="cpr" className={inputCls} inputMode="numeric" maxLength={13} pattern="[0-9]{9}" title="9 digits" value={v.cpr} onChange={(e) => setV((p) => ({ ...p, cpr: cprInput(e.target.value) }))} required />
          {fe.cpr && <p className="mt-1 text-sm text-crimson">{fe.cpr}</p>}
          {state.existing && (
            <p className="mt-1 text-sm">
              <Link href={`/admin/donors/${state.existing.id}`} className="text-crimson underline">
                Open {state.existing.name}
              </Link>
            </p>
          )}
        </div>
        <div>
          <label htmlFor="phone" className={labelCls}>
            Phone
          </label>
          <input id="phone" name="phone" className={inputCls} inputMode="numeric" maxLength={16} pattern="[0-9]{8}" title="8 digits" value={v.phone} onChange={(e) => setV((p) => ({ ...p, phone: phoneInput(e.target.value) }))} />
          {fe.phone && <p className="mt-1 text-sm text-crimson">{fe.phone}</p>}
        </div>
        <div>
          <label htmlFor="email" className={labelCls}>
            Email
          </label>
          <input id="email" name="email" type="email" className={inputCls} value={v.email} onChange={set("email")} />
          {fe.email && <p className="mt-1 text-sm text-crimson">{fe.email}</p>}
        </div>
        <div>
          <label htmlFor="dob" className={labelCls}>
            Date of birth
          </label>
          <input id="dob" name="dob" type="date" className={inputCls} value={v.dob} onChange={set("dob")} />
          {fe.dob && <p className="mt-1 text-sm text-crimson">{fe.dob}</p>}
        </div>
        <div>
          <label htmlFor="bloodType" className={labelCls}>
            Blood type
          </label>
          <select id="bloodType" name="bloodType" className={inputCls} value={v.bloodType} onChange={set("bloodType")}>
            {BLOOD_TYPES.map((b) => (
              <option key={b} value={b}>
                {b === "unknown" ? "Unknown" : b}
              </option>
            ))}
          </select>
        </div>
        {showSlot && (
          <div>
            <label htmlFor="slotId" className={labelCls}>
              Slot {mode === "add" ? "*" : ""}
            </label>
            <select id="slotId" name="slotId" className={inputCls} value={v.slotId} onChange={set("slotId")}>
              <option value="">{mode === "edit" ? "No slot" : "Choose a time"}</option>
              {slots.map((s) => (
                <option key={s.id} value={s.id}>
                  {formatSlot(s.starts_at, "en")}
                </option>
              ))}
            </select>
            {fe.slotId && <p className="mt-1 text-sm text-crimson">{fe.slotId}</p>}
          </div>
        )}
      </div>

      <fieldset className="rounded-lg border border-line bg-white p-4">
        <legend className="px-1 text-sm font-bold">Screening</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="recentDonation" className={labelCls}>
              Donated blood in the last 3 months?
            </label>
            <select id="recentDonation" name="recentDonation" className={inputCls} value={v.recentDonation} onChange={set("recentDonation")}>
              <option value="">Not asked</option>
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>
          </div>
          <div>
            <label htmlFor="onMedication" className={labelCls}>
              Taking antibiotics or medication?
            </label>
            <select id="onMedication" name="onMedication" className={inputCls} value={v.onMedication} onChange={set("onMedication")}>
              <option value="">Not asked</option>
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>
          </div>
        </div>
        <p className="mt-2 text-xs text-ink-soft">Answers flag the donor for review. They never block registration.</p>
      </fieldset>

      <div>
        <label htmlFor="notes" className={labelCls}>
          Notes
        </label>
        <textarea id="notes" name="notes" rows={3} maxLength={1000} className={inputCls} value={v.notes} onChange={set("notes")} dir="auto" />
        {fe.notes && <p className="mt-1 text-sm text-crimson">{fe.notes}</p>}
      </div>

      {mode === "add" && (
        <div className="space-y-2">
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="consent" defaultChecked className="mt-0.5 size-4 accent-crimson" />
            <span>{CONSENT_TEXT}</span>
          </label>
          {fe.consent && <p className="text-sm text-crimson">{fe.consent}</p>}
          {regMode === "walk_in" && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="checkInNow" defaultChecked className="size-4 accent-crimson" />
              Check in now
            </label>
          )}
        </div>
      )}

      {state.error && !state.existing && (
        <p role="alert" className="rounded-md bg-blush px-3 py-2 text-sm text-crimson-dark">
          {state.error}
        </p>
      )}
      {state.existing && (
        <p role="alert" className="rounded-md bg-blush px-3 py-2 text-sm text-crimson-dark">
          {mode === "add" ? (
            <>
              This CPR is already registered for {state.existing.name}.{" "}
              <Link href={`/admin/donors/${state.existing.id}`} className="underline">
                View donor
              </Link>
            </>
          ) : (
            state.error
          )}
        </p>
      )}

      <div className="flex gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving..." : mode === "add" ? "Save donor" : "Save changes"}
        </Button>
        <Button asChild variant="outline">
          <Link href={mode === "edit" && defaults.id ? `/admin/donors/${defaults.id}` : "/admin"}>Cancel</Link>
        </Button>
      </div>
    </form>
  );
}
