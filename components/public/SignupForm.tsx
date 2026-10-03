"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BLOOD_TYPES, AGE_MAX, AGE_MIN } from "@/lib/config";
import { normaliseDigits, toAsciiDigits } from "@/lib/cpr";
import { formatSlot } from "@/lib/format";
import type { Dictionary, Locale } from "@/lib/i18n";
import { t } from "@/lib/i18n";
import { ageOn } from "@/lib/screening";
import { signupClientSchema } from "@/lib/validation";
import { Turnstile, type TurnstileHandle } from "@/components/public/Turnstile";

export type SlotOption = { id: number; startsAt: string; capacity: number; booked: number };

type Props = {
  locale: Locale;
  dict: Dictionary;
  slots: SlotOption[];
  eventDate: string;
  slotHint: string;
};

type Values = {
  slotId: string;
  fullName: string;
  cpr: string;
  dob: string;
  phone: string;
  email: string;
  bloodType: string;
  recentDonation: "" | "yes" | "no";
  onMedication: "" | "yes" | "no";
  consent: boolean;
};

const FIELD_ORDER = [
  "slotId",
  "fullName",
  "cpr",
  "dob",
  "phone",
  "email",
  "bloodType",
  "recentDonation",
  "onMedication",
  "consent",
] as const;

const inputCls =
  "w-full rounded-lg border border-line bg-white px-3 py-2.5 text-base text-ink outline-none focus:border-crimson focus:ring-2 focus:ring-crimson/20 disabled:opacity-60";
const labelCls = "mb-1 block text-sm font-medium text-ink";
const errCls = "mt-1 text-sm text-crimson";

export function SignupForm({ locale, dict, slots, eventDate, slotHint }: Props) {
  const router = useRouter();
  const [v, setV] = useState<Values>({
    slotId: "",
    fullName: "",
    cpr: "",
    dob: "",
    phone: "",
    email: "",
    bloodType: "unknown",
    recentDonation: "",
    onMedication: "",
    consent: false,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [slow, setSlow] = useState(false);
  const [token, setToken] = useState("");
  const turnstile = useRef<TurnstileHandle>(null);
  const dobRef = useRef<HTMLInputElement>(null);
  const slowTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(slowTimer.current), []);

  const onToken = useCallback((tk: string) => setToken(tk), []);

  function set<K extends keyof Values>(key: K, value: Values[K]) {
    setV((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  const dobAscii = toAsciiDigits(v.dob.trim());
  const age = /^\d{4}-\d{2}-\d{2}$/.test(dobAscii) ? ageOn(dobAscii, eventDate) : null;
  const ageOut = age !== null && (age < AGE_MIN || age > AGE_MAX);

  function validate(): boolean {
    const result = signupClientSchema.safeParse({
      slotId: v.slotId === "" ? undefined : Number(v.slotId),
      fullName: v.fullName,
      cpr: v.cpr,
      dob: v.dob,
      phone: v.phone,
      email: v.email,
      bloodType: v.bloodType,
      recentDonation: v.recentDonation === "" ? undefined : v.recentDonation === "yes",
      onMedication: v.onMedication === "" ? undefined : v.onMedication === "yes",
      consent: v.consent,
    });
    if (result.success) {
      setErrors({});
      return true;
    }
    const next: Record<string, string> = {};
    for (const issue of result.error.issues) {
      const key = String(issue.path[0] ?? "_");
      if (!(key in next)) next[key] = issue.message;
    }
    setErrors(next);
    const first = FIELD_ORDER.find((k) => k in next);
    if (first) {
      const el = document.getElementById(`f-${first}`);
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
      const target = el && /^(INPUT|SELECT)$/.test(el.tagName) ? el : el?.querySelector("input,select");
      (target as HTMLElement | null | undefined)?.focus();
    }
    return false;
  }

  function errText(key: string): string {
    const code = errors[key];
    if (!code) return "";
    const table = dict.errors as Record<string, string>;
    return table[code] ?? dict.errors.server;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setFormError("");
    if (!validate()) return;
    setSubmitting(true);
    setSlow(false);
    clearTimeout(slowTimer.current);
    slowTimer.current = setTimeout(() => setSlow(true), 10_000);
    const failed = (message: string) => {
      setFormError(message);
      turnstile.current?.reset();
    };
    try {
      const res = await fetch("/api/signup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          slotId: Number(v.slotId),
          fullName: v.fullName,
          cpr: v.cpr,
          dob: v.dob,
          phone: v.phone,
          email: v.email,
          bloodType: v.bloodType,
          recentDonation: v.recentDonation === "yes",
          onMedication: v.onMedication === "yes",
          consent: v.consent,
          token,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        fields?: Record<string, string>;
        ref?: string;
        slotId?: number;
        emailStatus?: string;
      };
      if (res.ok && json.ok) {
        const qs = new URLSearchParams({
          ref: json.ref ?? "",
          slot: String(json.slotId ?? ""),
          email: json.emailStatus ?? "none",
        });
        router.push(`/${locale}/join/success?${qs.toString()}`);
        return;
      }
      switch (json.error) {
        case "duplicate_cpr":
          failed(dict.errors.duplicate_cpr);
          break;
        case "slot_full":
        case "slot_unavailable":
          failed(dict.errors.slot_full);
          router.refresh();
          break;
        case "turnstile":
          failed(dict.errors.turnstile);
          break;
        case "rate_limited":
          failed(dict.errors.rate_limited);
          break;
        case "validation":
          if (json.fields) setErrors(json.fields);
          failed(dict.errors.server);
          break;
        default:
          failed(dict.errors.server);
      }
    } catch {
      failed(dict.errors.network);
    } finally {
      clearTimeout(slowTimer.current);
      setSubmitting(false);
      setSlow(false);
    }
  }

  const consentParts = dict.join.consent.split("{privacyLink}");

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5" aria-busy={submitting}>
      <div>
        <label htmlFor="f-slotId" className={labelCls}>
          {dict.join.slot}
        </label>
        <select
          id="f-slotId"
          className={inputCls}
          value={v.slotId}
          onChange={(e) => set("slotId", e.target.value)}
          aria-invalid={!!errors.slotId}
        >
          <option value="">{dict.join.choose_slot}</option>
          {slots.map((s) => {
            const full = s.booked >= s.capacity;
            return (
              <option key={s.id} value={s.id} disabled={full}>
                {formatSlot(s.startsAt, locale)}
                {full ? ` ${dict.join.slot_full_suffix}` : ""}
              </option>
            );
          })}
        </select>
        <p className="mt-1 text-sm text-ink-soft">{slotHint}</p>
        {errors.slotId && <p className={errCls}>{errText("slotId")}</p>}
      </div>

      <div>
        <label htmlFor="f-fullName" className={labelCls}>
          {dict.join.full_name}
        </label>
        <input
          id="f-fullName"
          className={inputCls}
          autoComplete="name"
          value={v.fullName}
          maxLength={150}
          onChange={(e) => set("fullName", e.target.value)}
          aria-invalid={!!errors.fullName}
        />
        {errors.fullName && <p className={errCls}>{errText("fullName")}</p>}
      </div>

      <div>
        <label htmlFor="f-cpr" className={labelCls}>
          {dict.join.cpr}
        </label>
        <input
          id="f-cpr"
          className={inputCls}
          inputMode="numeric"
          maxLength={9}
          autoComplete="off"
          dir="ltr"
          value={v.cpr}
          onChange={(e) => {
            const el = e.target;
            const value = el.value;
            set("cpr", value);
            const atEnd = el.selectionStart === value.length;
            if (value.length === 9 && /^[0-9]{9}$/.test(normaliseDigits(value)) && atEnd) {
              dobRef.current?.focus();
            }
          }}
          aria-invalid={!!errors.cpr}
        />
        {errors.cpr && <p className={errCls}>{errText("cpr")}</p>}
      </div>

      <div>
        <label htmlFor="f-dob" className={labelCls}>
          {dict.join.dob}
        </label>
        <input
          id="f-dob"
          ref={dobRef}
          type="date"
          className={inputCls}
          dir="ltr"
          value={v.dob}
          onChange={(e) => set("dob", e.target.value)}
          aria-invalid={!!errors.dob}
        />
        {age !== null && (
          <p
            className={
              "mt-1 rounded-md px-3 py-1.5 text-sm " + (ageOut ? "bg-flag-bg text-flag-ink" : "text-ink-soft")
            }
          >
            {t(ageOut ? dict.join.age_out : dict.join.age_ok, { age })}
          </p>
        )}
        {errors.dob && <p className={errCls}>{errText("dob")}</p>}
      </div>

      <div>
        <label htmlFor="f-phone" className={labelCls}>
          {dict.join.phone}
        </label>
        <input
          id="f-phone"
          className={inputCls}
          inputMode="numeric"
          maxLength={16}
          autoComplete="tel-national"
          dir="ltr"
          value={v.phone}
          onChange={(e) => set("phone", e.target.value)}
          aria-invalid={!!errors.phone}
        />
        {errors.phone && <p className={errCls}>{errText("phone")}</p>}
      </div>

      <div>
        <label htmlFor="f-email" className={labelCls}>
          {dict.join.email}
        </label>
        <input
          id="f-email"
          type="email"
          className={inputCls}
          autoComplete="email"
          dir="ltr"
          value={v.email}
          onChange={(e) => set("email", e.target.value)}
          aria-invalid={!!errors.email}
        />
        {errors.email && <p className={errCls}>{errText("email")}</p>}
      </div>

      <div>
        <label htmlFor="f-bloodType" className={labelCls}>
          {dict.join.blood_type}
        </label>
        <select
          id="f-bloodType"
          className={inputCls}
          value={v.bloodType}
          onChange={(e) => set("bloodType", e.target.value)}
        >
          {BLOOD_TYPES.map((b) => (
            <option key={b} value={b}>
              {b === "unknown" ? dict.bloodType.unknown : b}
            </option>
          ))}
        </select>
      </div>

      <fieldset className="rounded-xl border border-line bg-paper-2 p-4">
        <legend className="px-1 text-sm font-bold text-ink">{dict.screening.title}</legend>
        {(["recentDonation", "onMedication"] as const).map((key) => (
          <div key={key} id={`f-${key}`} className="border-b border-line py-3 last:border-b-0">
            <p className="mb-2 text-sm text-ink">{dict.screening[key]}</p>
            <div className="flex gap-6">
              {(["yes", "no"] as const).map((opt) => (
                <label key={opt} className="flex items-center gap-2 text-base">
                  <input
                    type="radio"
                    name={key}
                    value={opt}
                    checked={v[key] === opt}
                    onChange={() => set(key, opt)}
                    className="size-5 accent-crimson"
                  />
                  {dict.screening[opt]}
                </label>
              ))}
            </div>
            {errors[key] && <p className={errCls}>{errText(key)}</p>}
          </div>
        ))}
        <p className="mt-2 text-sm text-ink-soft">{dict.screening.hint}</p>
      </fieldset>

      <div id="f-consent">
        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            checked={v.consent}
            onChange={(e) => set("consent", e.target.checked)}
            className="mt-1 size-5 shrink-0 accent-crimson"
            aria-invalid={!!errors.consent}
          />
          <span>
            {consentParts[0]}
            <Link href={`/${locale}/privacy`} className="font-medium text-crimson underline">
              {dict.join.privacy_link}
            </Link>
            {consentParts[1]}
          </span>
        </label>
        {errors.consent && <p className={errCls}>{errText("consent")}</p>}
      </div>

      <Turnstile ref={turnstile} locale={locale} onToken={onToken} warning={dict.join.turnstile_missing} />

      {formError && (
        <p role="alert" className="rounded-lg bg-blush px-3 py-2 text-sm text-crimson-dark">
          {formError}
        </p>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="w-full rounded-lg bg-crimson px-4 py-3 text-base font-bold text-white hover:bg-crimson-dark disabled:opacity-60"
      >
        {submitting ? dict.join.saving : dict.join.submit}
      </button>
      {slow && <p className="text-center text-sm text-ink-soft">{dict.join.slow}</p>}
    </form>
  );
}
