"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BLOOD_TYPES, AGE_MAX, AGE_MIN } from "@/lib/config";
import { cprInput, phoneInput, toAsciiDigits } from "@/lib/cpr";
import { CARD_TOKEN_KEY } from "@/components/public/CardDownload";
import { formatDate, formatSlot } from "@/lib/format";
import type { Dictionary, Locale } from "@/lib/i18n";
import { t } from "@/lib/i18n";
import { ageOn } from "@/lib/screening";
import {
  STEP_FIELDS,
  errorsForStep,
  photoRequired,
  signupSteps,
  stepOfField,
  type StepId,
} from "@/lib/signup-steps";
import { signupClientSchema, signupWalkInClientSchema } from "@/lib/validation";
import { CprImageField } from "@/components/public/CprImageField";
import { Turnstile, type TurnstileHandle } from "@/components/public/Turnstile";

export type SlotOption = { id: number; startsAt: string; capacity: number; booked: number };

type Props = {
  locale: Locale;
  dict: Dictionary;
  slots: SlotOption[];
  eventDate: string;
  slotHint: string;
  walkIn: boolean;
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

type FocusTarget = "heading" | "field" | "summary" | "id";
type FocusRequest = { target: FocusTarget; step: StepId; id?: string; seq: number };

const FIRST_INPUT: Partial<Record<StepId, string>> = {
  name: "f-fullName",
  identity: "f-cpr",
  contact: "f-phone",
};

const inputCls =
  "h-14 w-full rounded-xl border-2 border-line bg-white px-4 text-lg text-ink outline-none focus-visible:border-crimson focus-visible:ring-4 focus-visible:ring-crimson/20 disabled:opacity-60";
const labelCls = "mb-1 block text-base font-medium text-ink";
const errCls = "mt-1 text-sm text-crimson";
const headingCls = "text-2xl font-bold text-ink focus:outline-none";
const cardCls =
  "flex min-h-11 items-center gap-3 rounded-xl border-2 border-line bg-white p-4 has-[:checked]:border-crimson has-[:checked]:bg-blush has-[:focus-visible]:ring-4 has-[:focus-visible]:ring-crimson/20 has-[:disabled]:opacity-60";
const radioCls = "size-5 accent-crimson";
const btnPrimaryCls =
  "h-12 rounded-xl bg-crimson px-6 font-bold text-white hover:bg-crimson-dark focus-visible:ring-4 focus-visible:ring-crimson/30 focus-visible:outline-none disabled:opacity-60";
const btnSecondaryCls =
  "h-12 rounded-xl border-2 border-line bg-white px-5 font-medium text-ink hover:bg-paper-2 focus-visible:ring-4 focus-visible:ring-crimson/20 focus-visible:outline-none disabled:opacity-60";
const btnChangeCls =
  "min-h-11 shrink-0 rounded-xl border-2 border-line bg-white px-4 text-sm font-medium text-crimson hover:bg-paper-2 focus-visible:ring-4 focus-visible:ring-crimson/20 focus-visible:outline-none";

const subscribeNever = () => () => {};

const desc = (...ids: (string | false | undefined)[]) => ids.filter(Boolean).join(" ") || undefined;

export function SignupForm({ locale, dict, slots, eventDate, slotHint, walkIn }: Props) {
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
  const [cprImage, setCprImage] = useState<Blob | null>(null);
  const [imageBusy, setImageBusy] = useState(false);
  const [slow, setSlow] = useState(false);
  const [token, setToken] = useState("");
  const [stepId, setStepId] = useState<StepId>(() => signupSteps(walkIn)[0] ?? "name");
  const [returnToReview, setReturnToReview] = useState(false);
  // False on the server and during hydration, true afterwards (the controls are disabled until then).
  const hydrated = useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );
  const [focusReq, setFocusReq] = useState<FocusRequest | null>(null);
  const turnstile = useRef<TurnstileHandle>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const dobRef = useRef<HTMLInputElement>(null);
  const slowTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(slowTimer.current), []);

  const onToken = useCallback((tk: string) => setToken(tk), []);

  const steps = signupSteps(walkIn);
  const step: StepId = steps.includes(stepId) ? stepId : (steps[0] ?? "name");
  const stepIndex = steps.indexOf(step);

  // Moves focus only after a step change or a failed Next, never on the first render.
  useEffect(() => {
    if (!focusReq) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    formRef.current?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
    let el: HTMLElement | null = null;
    if (focusReq.target === "heading") el = document.getElementById(`step-${focusReq.step}-title`);
    else if (focusReq.target === "summary") el = document.getElementById(`err-${focusReq.step}`);
    else if (focusReq.target === "field") {
      const id = FIRST_INPUT[focusReq.step];
      el = id ? document.getElementById(id) : document.getElementById(`step-${focusReq.step}-title`);
    } else if (focusReq.id) {
      const target = document.getElementById(focusReq.id);
      el = target && target.tagName === "INPUT" ? target : (target?.querySelector("input:not(:disabled)") ?? target);
    }
    el?.focus();
  }, [focusReq]);

  function requestFocus(target: FocusTarget, onStep: StepId, id?: string) {
    setFocusReq((prev) => ({ target, step: onStep, id, seq: (prev?.seq ?? 0) + 1 }));
  }

  function go(to: StepId, target: FocusTarget, id?: string) {
    // Turnstile unmounts when leaving review, so its token is no longer valid.
    if (step === "review" && to !== "review") setToken("");
    setStepId(to);
    requestFocus(target, to, id);
  }

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
  const dobIso = /^\d{4}-\d{2}-\d{2}$/.test(dobAscii);
  const age = dobIso ? ageOn(dobAscii, eventDate) : null;
  const ageOut = age !== null && (age < AGE_MIN || age > AGE_MAX);

  /** Every field's current error, from the mode's client schema plus the photo rule. */
  function validateAll(): Record<string, string> {
    const input = {
      ...(walkIn ? {} : { slotId: v.slotId === "" ? undefined : Number(v.slotId) }),
      fullName: v.fullName,
      cpr: v.cpr,
      dob: v.dob,
      phone: v.phone,
      email: v.email,
      bloodType: v.bloodType,
      recentDonation: v.recentDonation === "" ? undefined : v.recentDonation === "yes",
      onMedication: v.onMedication === "" ? undefined : v.onMedication === "yes",
      consent: v.consent,
    };
    const result = (walkIn ? signupWalkInClientSchema : signupClientSchema).safeParse(input);
    const next: Record<string, string> = {};
    if (!result.success) {
      for (const issue of result.error.issues) {
        const key = String(issue.path[0] ?? "_");
        if (!(key in next)) next[key] = issue.message;
      }
    }
    if (photoRequired(walkIn) && !cprImage) next.cprImage = "cpr_image_required";
    return next;
  }

  function advance() {
    const stepErrors = errorsForStep(validateAll(), step);
    setErrors((prev) => {
      const next = { ...prev };
      for (const key of STEP_FIELDS[step]) delete next[key];
      return { ...next, ...stepErrors };
    });
    if (Object.keys(stepErrors).length > 0) {
      requestFocus("summary", step);
      return;
    }
    if (returnToReview) {
      setReturnToReview(false);
      go("review", "heading");
      return;
    }
    const next = steps[stepIndex + 1];
    if (next) go(next, step === "name" || step === "identity" || step === "contact" ? "field" : "heading");
  }

  function back() {
    const prev = steps[stepIndex - 1];
    if (!prev) return;
    setReturnToReview(false);
    go(prev, "heading");
  }

  function change(to: StepId) {
    setReturnToReview(true);
    go(to, "heading");
  }

  /** Show the length error as soon as a partly filled field is left, rather than only on submit. */
  function markLength(key: "cpr" | "phone", value: string, length: number, code: string) {
    if (value === "" || value.length === length) return;
    setErrors((prev) => (prev[key] ? prev : { ...prev, [key]: code }));
  }

  function errText(key: string): string {
    const code = errors[key];
    if (!code) return "";
    const table = dict.errors as Record<string, string>;
    return table[code] ?? dict.errors.server;
  }

  function jumpToField(field: string) {
    const owner = stepOfField(field, walkIn);
    if (!owner) return;
    if (owner !== step) {
      setReturnToReview(step === "review");
      go(owner, "id", `f-${field}`);
    } else {
      requestFocus("id", owner, `f-${field}`);
    }
  }

  async function submit() {
    if (submitting || imageBusy) return;
    setFormError("");
    const all = validateAll();
    if (Object.keys(all).length > 0) {
      setErrors(all);
      requestFocus("summary", "review");
      return;
    }
    setErrors({});
    setSubmitting(true);
    setSlow(false);
    clearTimeout(slowTimer.current);
    slowTimer.current = setTimeout(() => setSlow(true), 10_000);
    const failed = (message: string) => {
      setFormError(message);
      turnstile.current?.reset();
    };
    try {
      const payload = {
        ...(walkIn ? {} : { slotId: Number(v.slotId) }),
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
      };
      // The public form always sends multipart; the photo part is present when a photo was attached.
      const fd = new FormData();
      fd.set("payload", JSON.stringify(payload));
      if (cprImage) fd.set("cprImage", cprImage, "cpr.jpg");
      const res = await fetch("/api/signup", { method: "POST", body: fd });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        fields?: Record<string, string>;
        ref?: string;
        slotId?: number;
        walkIn?: boolean;
        queueNumber?: number | null;
        emailStatus?: string;
        card?: string;
      };
      if (res.ok && json.ok) {
        try {
          if (json.card) sessionStorage.setItem(CARD_TOKEN_KEY, json.card);
        } catch {
          // Storage blocked (private mode): the success page just hides the download button.
        }
        const qs = new URLSearchParams({ ref: json.ref ?? "" });
        if (json.walkIn) {
          qs.set("slot", "walk_in");
          if (typeof json.queueNumber === "number" && Number.isInteger(json.queueNumber) && json.queueNumber > 0) {
            qs.set("queue", String(json.queueNumber));
          }
        } else {
          qs.set("slot", String(json.slotId ?? ""));
        }
        qs.set("email", json.emailStatus ?? "none");
        router.push(`/${locale}/join/success?${qs.toString()}`);
        return;
      }
      switch (json.error) {
        case "duplicate_cpr":
          failed(dict.errors.duplicate_cpr);
          break;
        case "slot_full":
        case "slot_unavailable":
          setErrors((prev) => ({ ...prev, slotId: "slot_full" }));
          setV((prev) => ({ ...prev, slotId: "" }));
          failed(dict.errors.slot_full);
          router.refresh();
          break;
        case "turnstile":
          failed(dict.errors.turnstile);
          break;
        case "rate_limited":
          failed(dict.errors.rate_limited);
          break;
        case "too_large":
          setErrors((prev) => ({ ...prev, cprImage: "cpr_image_too_large" }));
          failed(dict.errors.cpr_image_too_large);
          break;
        case "validation":
          if (walkIn && json.fields && "slotId" in json.fields) {
            // Walk-in mode ended while the page was open: the slot step comes back after the refresh.
            failed(dict.errors.form_changed);
            setErrors(json.fields);
            router.refresh();
          } else {
            setErrors(json.fields ?? {});
            if (!json.fields || Object.keys(json.fields).length === 0) {
              failed(dict.errors.server);
            } else {
              turnstile.current?.reset();
              requestFocus("summary", "review");
            }
          }
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

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!hydrated || submitting) return;
    if (step === "review") void submit();
    else advance();
  }

  const consentParts = dict.join.consent.split("{privacyLink}");
  const photoLabel = walkIn ? dict.join.q_photo_optional : dict.join.q_photo;
  const itemLabel: Record<StepId, string> = {
    slot: dict.join.q_slot,
    name: dict.join.q_name,
    identity: dict.join.q_identity,
    contact: dict.join.q_contact,
    bloodType: dict.join.q_blood_type,
    photo: photoLabel,
    screening: dict.screening.title,
    review: dict.join.q_review,
  };

  const sectionCls = (id: StepId) =>
    id === step
      ? "space-y-4 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 motion-safe:duration-200"
      : "space-y-4";

  function fieldError(key: string) {
    return errors[key] ? (
      <p id={`f-${key}-error`} className={errCls}>
        {errText(key)}
      </p>
    ) : null;
  }

  function summary(forStep: StepId) {
    const items: [string, string][] = [];
    const visible = forStep === "review" ? steps : [forStep];
    for (const s of visible) {
      for (const field of STEP_FIELDS[s]) if (errors[field]) items.push([field, errText(field)]);
    }
    if (items.length === 0) return null;
    return (
      <div
        id={`err-${forStep}`}
        tabIndex={-1}
        aria-labelledby={`err-${forStep}-title`}
        className="rounded-xl border-2 border-crimson bg-blush p-4 focus:outline-none"
      >
        <h3 id={`err-${forStep}-title`} className="font-bold text-crimson-dark">
          {dict.join.error_summary_title}
        </h3>
        <ul className="mt-2 list-disc ps-5 text-sm text-crimson-dark">
          {items.map(([field, message]) => (
            <li key={field}>
              <a
                href={`#f-${field}`}
                className="underline"
                onClick={(e) => {
                  e.preventDefault();
                  jumpToField(field);
                }}
              >
                {message}
              </a>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  function yesNo(key: "recentDonation" | "onMedication") {
    return (
      <fieldset id={`f-${key}`} aria-describedby={desc(errors[key] && `f-${key}-error`)} className="space-y-2">
        <legend className="mb-2 text-base font-medium text-ink">{dict.screening[key]}</legend>
        <div className="grid grid-cols-2 gap-3">
          {(["yes", "no"] as const).map((opt) => (
            <label key={opt} className={cardCls}>
              <input
                type="radio"
                name={key}
                value={opt}
                checked={v[key] === opt}
                onChange={() => set(key, opt)}
                className={radioCls}
              />
              {dict.screening[opt]}
            </label>
          ))}
        </div>
        {fieldError(key)}
      </fieldset>
    );
  }

  const row = (label: string, value: string, ltr = false) => (
    <div key={label} className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
      <dt className="text-sm text-ink-soft sm:w-40 sm:shrink-0">{label}</dt>
      <dd dir={ltr ? "ltr" : undefined} className="font-medium text-ink break-words">
        {value}
      </dd>
    </div>
  );

  const group = (id: StepId, rows: React.ReactNode) => (
    <div key={id} className="flex items-start justify-between gap-3 border-b border-line py-3 last:border-b-0">
      <dl className="min-w-0 space-y-1">{rows}</dl>
      <button
        type="button"
        className={btnChangeCls}
        aria-label={t(dict.join.review_change_label, { item: itemLabel[id] })}
        onClick={() => change(id)}
      >
        {dict.join.review_change}
      </button>
    </div>
  );

  const primaryLabel =
    step === "review"
      ? submitting
        ? dict.join.saving
        : dict.join.submit
      : returnToReview
        ? dict.join.review_return
        : dict.join.next;

  return (
    <form ref={formRef} noValidate onSubmit={onSubmit} aria-busy={submitting} className="space-y-5">
      {walkIn && <div className="rounded-xl bg-paper-2 p-4 text-base text-ink">{dict.join.walk_in_notice}</div>}

      <div>
        <p aria-live="polite" aria-atomic="true" className="text-sm font-medium text-ink-soft">
          {t(dict.join.step_of, { n: stepIndex + 1, total: steps.length })}
        </p>
        <div aria-hidden="true" className="mt-2 h-2 overflow-hidden rounded-full bg-paper-2">
          <div
            className="h-full rounded-full bg-crimson transition-[width] motion-reduce:transition-none"
            style={{ width: `${((stepIndex + 1) / steps.length) * 100}%` }}
          />
        </div>
      </div>

      {/* A real box, not display:contents: the form's spacing only reaches its own children, and gap skips hidden steps. */}
      <fieldset disabled={!hydrated} className="flex min-w-0 flex-col gap-6">
        {!hydrated && (
          <p role="status" className="text-sm text-ink-soft">
            {dict.join.loading}
          </p>
        )}

        {!walkIn && (
          <section aria-labelledby="step-slot-title" hidden={step !== "slot"} className={sectionCls("slot")}>
            {step === "slot" && summary("slot")}
            <fieldset
              id="f-slotId"
              aria-describedby={desc("slot-hint", errors.slotId && "f-slotId-error")}
              className="space-y-3"
            >
              <legend className="mb-2 p-0">
                <h2 id="step-slot-title" tabIndex={-1} className={headingCls}>
                  {dict.join.q_slot}
                </h2>
              </legend>
              <p id="slot-hint" className="text-sm text-ink-soft">
                {slotHint}
              </p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {slots.map((s) => {
                  const full = s.booked >= s.capacity;
                  return (
                    <label key={s.id} className={cardCls}>
                      <input
                        type="radio"
                        name="slotId"
                        value={String(s.id)}
                        checked={v.slotId === String(s.id)}
                        disabled={full}
                        onChange={() => set("slotId", String(s.id))}
                        className={radioCls}
                      />
                      <span>
                        {formatSlot(s.startsAt, locale)}
                        {full ? ` ${dict.join.slot_full_suffix}` : ""}
                      </span>
                    </label>
                  );
                })}
              </div>
              {fieldError("slotId")}
            </fieldset>
          </section>
        )}

        <section aria-labelledby="step-name-title" hidden={step !== "name"} className={sectionCls("name")}>
          {step === "name" && summary("name")}
          <h2 id="step-name-title" tabIndex={-1} className={headingCls}>
            <label htmlFor="f-fullName">{dict.join.q_name}</label>
          </h2>
          <input
            id="f-fullName"
            className={inputCls}
            autoComplete="name"
            value={v.fullName}
            maxLength={150}
            onChange={(e) => set("fullName", e.target.value)}
            aria-required="true"
            aria-invalid={!!errors.fullName}
            aria-describedby={desc(errors.fullName && "f-fullName-error")}
          />
          {fieldError("fullName")}
        </section>

        <section aria-labelledby="step-identity-title" hidden={step !== "identity"} className={sectionCls("identity")}>
          {step === "identity" && summary("identity")}
          <h2 id="step-identity-title" tabIndex={-1} className={headingCls}>
            {dict.join.q_identity}
          </h2>
          <div>
            <label htmlFor="f-cpr" className={labelCls}>
              {dict.join.cpr}
            </label>
            <input
              id="f-cpr"
              className={inputCls}
              inputMode="numeric"
              maxLength={13}
              autoComplete="off"
              dir="ltr"
              value={v.cpr}
              pattern="[0-9]{9}"
              onChange={(e) => {
                const el = e.target;
                const value = cprInput(el.value);
                const atEnd = el.selectionStart === el.value.length;
                set("cpr", value);
                if (value.length === 9 && atEnd) dobRef.current?.focus();
              }}
              onBlur={() => markLength("cpr", v.cpr, 9, "cpr_invalid")}
              aria-required="true"
              aria-invalid={!!errors.cpr}
              aria-describedby={desc(errors.cpr && "f-cpr-error")}
            />
            {fieldError("cpr")}
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
              autoComplete="bday"
              dir="ltr"
              value={v.dob}
              onChange={(e) => set("dob", e.target.value)}
              aria-required="true"
              aria-invalid={!!errors.dob}
              aria-describedby={desc("f-dob-age", errors.dob && "f-dob-error")}
            />
            <p
              id="f-dob-age"
              aria-live="polite"
              className={
                age !== null
                  ? "mt-1 rounded-md px-3 py-1.5 text-sm " + (ageOut ? "bg-flag-bg text-flag-ink" : "text-ink-soft")
                  : undefined
              }
            >
              {age !== null && t(ageOut ? dict.join.age_out : dict.join.age_ok, { age })}
            </p>
            {fieldError("dob")}
          </div>
        </section>

        <section aria-labelledby="step-contact-title" hidden={step !== "contact"} className={sectionCls("contact")}>
          {step === "contact" && summary("contact")}
          <h2 id="step-contact-title" tabIndex={-1} className={headingCls}>
            {dict.join.q_contact}
          </h2>
          <div>
            <label htmlFor="f-phone" className={labelCls}>
              {dict.join.phone}
            </label>
            <input
              id="f-phone"
              className={inputCls}
              inputMode="numeric"
              maxLength={16}
              pattern="[0-9]{8}"
              autoComplete="tel-national"
              dir="ltr"
              value={v.phone}
              onChange={(e) => set("phone", phoneInput(e.target.value))}
              onBlur={() => markLength("phone", v.phone, 8, "phone_invalid")}
              aria-required="true"
              aria-invalid={!!errors.phone}
              aria-describedby={desc(errors.phone && "f-phone-error")}
            />
            {fieldError("phone")}
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
              aria-describedby={desc(errors.email && "f-email-error")}
            />
            {fieldError("email")}
          </div>
        </section>

        <section
          aria-labelledby="step-bloodType-title"
          hidden={step !== "bloodType"}
          className={sectionCls("bloodType")}
        >
          {step === "bloodType" && summary("bloodType")}
          <fieldset id="f-bloodType" aria-describedby="bt-hint" className="space-y-3">
            <legend className="mb-2 p-0">
              <h2 id="step-bloodType-title" tabIndex={-1} className={headingCls}>
                {dict.join.q_blood_type}
              </h2>
            </legend>
            <p id="bt-hint" className="text-sm text-ink-soft">
              {dict.join.blood_type_hint}
            </p>
            <div className="grid grid-cols-3 gap-3">
              {BLOOD_TYPES.map((b) => (
                <label key={b} className={cardCls + (b === "unknown" ? " col-span-3" : "")}>
                  <input
                    type="radio"
                    name="bloodType"
                    value={b}
                    checked={v.bloodType === b}
                    onChange={() => set("bloodType", b)}
                    className={radioCls}
                  />
                  <span dir={b === "unknown" ? undefined : "ltr"}>{b === "unknown" ? dict.bloodType.unknown : b}</span>
                </label>
              ))}
            </div>
          </fieldset>
        </section>

        <section aria-labelledby="step-photo-title" hidden={step !== "photo"} className={sectionCls("photo")}>
          {step === "photo" && summary("photo")}
          <CprImageField
            dict={dict}
            value={cprImage}
            asHeading
            label={photoLabel}
            hint={walkIn ? dict.join.cpr_image_hint_walk_in : undefined}
            required={photoRequired(walkIn)}
            onChange={(b) => {
              setCprImage(b);
              if (b) {
                setErrors((prev) => {
                  if (!("cprImage" in prev)) return prev;
                  const next = { ...prev };
                  delete next.cprImage;
                  return next;
                });
              }
            }}
            onBusyChange={setImageBusy}
            error={errText("cprImage")}
          />
        </section>

        <section
          aria-labelledby="step-screening-title"
          hidden={step !== "screening"}
          className={sectionCls("screening")}
        >
          {step === "screening" && summary("screening")}
          <h2 id="step-screening-title" tabIndex={-1} className={headingCls}>
            {dict.screening.title}
          </h2>
          {yesNo("recentDonation")}
          {yesNo("onMedication")}
          <p className="text-sm text-ink-soft">{dict.screening.hint}</p>
        </section>

        <section aria-labelledby="step-review-title" hidden={step !== "review"} className={sectionCls("review")}>
          {step === "review" && summary("review")}
          <h2 id="step-review-title" tabIndex={-1} className={headingCls}>
            {dict.join.q_review}
          </h2>
          <div className="rounded-xl border-2 border-line bg-white px-4">
            {!walkIn &&
              group(
                "slot",
                row(
                  dict.join.slot,
                  (() => {
                    const s = slots.find((o) => String(o.id) === v.slotId);
                    return s ? formatSlot(s.startsAt, locale) : dict.join.review_none;
                  })(),
                ),
              )}
            {group("name", row(dict.join.full_name, v.fullName))}
            {group("identity", [
              row(dict.join.cpr, v.cpr, true),
              row(dict.join.dob, dobIso ? formatDate(dobAscii, locale) : v.dob),
            ])}
            {group("contact", [
              row(dict.join.phone, v.phone, true),
              row(dict.join.email.replace(/\s*\(.*\)\s*$/, ""), v.email.trim() || dict.join.review_none, true),
            ])}
            {group(
              "bloodType",
              row(dict.join.blood_type.replace(/\s*\(.*\)\s*$/, ""), v.bloodType === "unknown" ? dict.bloodType.unknown : v.bloodType),
            )}
            {group(
              "photo",
              row(dict.join.cpr_image, cprImage ? dict.join.review_photo_attached : dict.join.review_none),
            )}
            {group("screening", [
              row(dict.screening.recentDonation, v.recentDonation === "" ? dict.join.review_none : dict.screening[v.recentDonation]),
              row(dict.screening.onMedication, v.onMedication === "" ? dict.join.review_none : dict.screening[v.onMedication]),
            ])}
          </div>

          <div>
            <label className="flex min-h-11 items-start gap-3 text-sm">
              <input
                id="f-consent"
                type="checkbox"
                checked={v.consent}
                onChange={(e) => set("consent", e.target.checked)}
                className="mt-0.5 size-5 shrink-0 accent-crimson"
                aria-required="true"
                aria-invalid={!!errors.consent}
                aria-describedby={desc(errors.consent && "f-consent-error")}
              />
              <span>
                {consentParts[0]}
                <Link href={`/${locale}/privacy`} className="font-medium text-crimson underline">
                  {dict.join.privacy_link}
                </Link>
                {consentParts[1]}
              </span>
            </label>
            {fieldError("consent")}
          </div>

          {step === "review" && (
            <Turnstile ref={turnstile} locale={locale} onToken={onToken} warning={dict.join.turnstile_missing} />
          )}

          {formError && (
            <p role="alert" className="rounded-xl bg-blush px-4 py-3 text-sm text-crimson-dark">
              {formError}
            </p>
          )}
        </section>

        <div className="flex flex-wrap items-center gap-3">
          {stepIndex > 0 && (
            <button type="button" className={btnSecondaryCls} onClick={back} disabled={submitting}>
              {dict.common.back}
            </button>
          )}
          <button
            type="submit"
            className={btnPrimaryCls}
            disabled={submitting || (imageBusy && (step === "photo" || step === "review"))}
          >
            {primaryLabel}
          </button>
          <span aria-hidden="true" className="hidden text-sm text-ink-soft sm:inline">
            {dict.join.enter_hint}
          </span>
        </div>
        <p aria-live="polite" className="-mt-3 text-center text-sm text-ink-soft">
          {slow && dict.join.slow}
        </p>
      </fieldset>
    </form>
  );
}
