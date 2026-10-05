"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, CalendarDays, Loader2 } from "lucide-react";
import { BLOOD_TYPES, AGE_MAX, AGE_MIN } from "@/lib/config";
import { cprInput, phoneInput } from "@/lib/cpr";
import { shouldAdvance } from "@/lib/auto-advance";
import { cleanDobPart, composeDob, dobExample, dobPartsError, isoToDobParts } from "@/lib/dob";
import { reportClientError } from "@/lib/client-log";
import { keyboardInset } from "@/lib/keyboard-inset";
import {
  DRAFT_KEY,
  DRAFT_PHOTO_KEY,
  isEmptyDraft,
  parseDraft,
  parseDraftPhoto,
  serializeDraft,
  serializeDraftPhoto,
  type DraftValues,
} from "@/lib/signup-draft";
import {
  MAX_AUTO_RETRIES,
  SUBMIT_TIMEOUT_MS,
  TOKEN_WAIT_MS,
  classifySubmit,
  retryDelay,
} from "@/lib/submit-retry";
import { CARD_TOKEN_KEY } from "@/components/public/CardDownload";
import { formatDate, formatSlot } from "@/lib/format";
import type { Dictionary, Locale } from "@/lib/i18n";
import { dirFor, t } from "@/lib/i18n";
import { ageOn } from "@/lib/screening";
import { isRealDate, signupClientSchema, signupWalkInClientSchema } from "@/lib/validation";
import {
  STEP_FIELDS,
  errorsForStep,
  photoRequired,
  signupSteps,
  stepOfField,
  stepShift,
  type StepId,
} from "@/lib/signup-steps";
import { CprImageField, type CprImageFieldHandle } from "@/components/public/CprImageField";
import { EventIntro } from "@/components/public/EventIntro";
import { TopBar } from "@/components/public/TopBar";
import { btnPrimary, btnSecondary } from "@/components/public/button-classes";
import { useStepTransition } from "@/components/public/motion";
import { Turnstile, type TurnstileHandle } from "@/components/public/Turnstile";

export type SlotOption = { id: number; startsAt: string; capacity: number; booked: number };

type Props = {
  locale: Locale;
  dict: Dictionary;
  slots: SlotOption[];
  eventDate: string;
  slotHint: string;
  walkIn: boolean;
  event: { name: string; dateText: string; timeText: string; location: string };
};

type Values = {
  slotId: string;
  fullName: string;
  cpr: string;
  dobDay: string;
  dobMonth: string;
  dobYear: string;
  phone: string;
  email: string;
  bloodType: string;
  recentDonation: "" | "yes" | "no";
  onMedication: "" | "yes" | "no";
  consent: boolean;
};

type FocusTarget = "heading" | "field" | "summary" | "id" | "intro";
type FocusRequest = { target: FocusTarget; step: StepId; id?: string; seq: number };

const FIRST_INPUT: Partial<Record<StepId, string>> = {
  name: "f-fullName",
  identity: "f-cpr",
  contact: "f-phone",
};

const inputCls =
  "h-14 w-full rounded-xl border-2 border-line-strong bg-white px-4 text-lg text-ink placeholder:text-ink-soft transition-colors hover:border-ink-soft focus-visible:border-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand aria-[invalid=true]:border-danger disabled:opacity-60";
const labelCls = "mb-1 block text-base font-medium text-ink";
const errCls = "mt-1 text-sm font-medium text-danger";
const headingCls = "text-2xl font-bold text-ink focus:outline-none";
const cardCls =
  "flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border-2 border-line-strong bg-white p-4 transition-colors hover:border-brand/60 hover:bg-brand-tint/50 has-[:checked]:border-brand has-[:checked]:bg-brand-tint has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60";
const radioCls = "size-5 accent-brand";
const btnChangeCls =
  "min-h-11 shrink-0 rounded-xl px-3 text-sm font-medium text-brand underline-offset-4 hover:bg-brand-tint hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand";

const subscribeNever = () => () => {};

function safeGet(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}
function safeSet(key: string, value: string) {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    // Quota or blocked storage: the draft is a convenience.
  }
}
function safeRemove(key: string) {
  try {
    sessionStorage.removeItem(key);
  } catch {
    // ignore
  }
}

function subscribeVisualViewport(cb: () => void): () => void {
  const vv = window.visualViewport;
  if (!vv) return () => {};
  vv.addEventListener("resize", cb);
  vv.addEventListener("scroll", cb);
  return () => {
    vv.removeEventListener("resize", cb);
    vv.removeEventListener("scroll", cb);
  };
}
function getInset(): number {
  const vv = window.visualViewport;
  return vv ? keyboardInset(window.innerHeight, vv.height, vv.offsetTop) : 0;
}

/** Wall clock for event handlers (kept out of the component body for the purity lint). */
const nowMs = () => Date.now();

const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

const desc = (...ids: (string | false | undefined)[]) => ids.filter(Boolean).join(" ") || undefined;

export function SignupForm({ locale, dict, slots, eventDate, slotHint, walkIn, event }: Props) {
  const router = useRouter();
  const [v, setV] = useState<Values>({
    slotId: "",
    fullName: "",
    cpr: "",
    dobDay: "",
    dobMonth: "",
    dobYear: "",
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
  const [phase, setPhase] = useState<"intro" | "form">("intro");
  const [direction, setDirection] = useState<"forward" | "back">("forward");
  const [submissionId, setSubmissionId] = useState<string | null>(null);
  const [retryInfo, setRetryInfo] = useState<{ n: number; total: number } | null>(null);
  const [retryable, setRetryable] = useState(false);
  const [restoredNotice, setRestoredNotice] = useState("");
  const navigated = useRef(false);
  const restoringPhoto = useRef(false);
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
  const cprField = useRef<CprImageFieldHandle>(null);
  const mainRef = useRef<HTMLElement>(null);
  const tokenRef = useRef("");
  const tokenWaiters = useRef<((tk: string) => void)[]>([]);
  const kb = useSyncExternalStore(subscribeVisualViewport, getInset, () => 0);
  const draftRaw = useSyncExternalStore(subscribeNever, () => safeGet(DRAFT_KEY), () => null);
  const hasDraft = useMemo(() => parseDraft(draftRaw, { eventDate, walkIn }) !== null, [draftRaw, eventDate, walkIn]);
  const formRef = useRef<HTMLFormElement>(null);
  const dobRef = useRef<HTMLInputElement>(null);
  const dobMonthRef = useRef<HTMLInputElement>(null);
  const dobYearRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const slowTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(slowTimer.current), []);

  const onToken = useCallback((tk: string) => {
    tokenRef.current = tk;
    if (tk) {
      const waiters = tokenWaiters.current;
      tokenWaiters.current = [];
      for (const w of waiters) w(tk);
    }
  }, []);

  function waitForToken(ms: number): Promise<string> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        tokenWaiters.current = tokenWaiters.current.filter((w) => w !== done);
        resolve("");
      }, ms);
      const done = (tk: string) => {
        clearTimeout(timer);
        resolve(tk);
      };
      tokenWaiters.current.push(done);
    });
  }

  const steps = signupSteps(walkIn);
  const step: StepId = steps.includes(stepId) ? stepId : (steps[0] ?? "name");
  const stepIndex = steps.indexOf(step);

  // Turnstile unmounts when leaving review, so its token is no longer valid.
  useEffect(() => {
    if (step !== "review") tokenRef.current = "";
  }, [step]);

  useStepTransition(mainRef, `${phase}:${step}`, stepShift(direction, dirFor(locale)), () => navigated.current);

  // Writes the text draft. Only touches storage; never sets state.
  useEffect(() => {
    if (phase !== "form") return;
    const values: DraftValues = {
      slotId: v.slotId,
      fullName: v.fullName,
      cpr: v.cpr,
      dobDay: v.dobDay,
      dobMonth: v.dobMonth,
      dobYear: v.dobYear,
      phone: v.phone,
      email: v.email,
      bloodType: v.bloodType === "unknown" ? "" : v.bloodType,
      recentDonation: v.recentDonation,
      onMedication: v.onMedication,
    };
    if (isEmptyDraft(values) && !cprImage) safeRemove(DRAFT_KEY);
    else safeSet(DRAFT_KEY, serializeDraft({ eventDate, step, values, submissionId, hadPhoto: !!cprImage }, Date.now()));
  }, [phase, step, v, submissionId, cprImage, eventDate]);

  // Writes the photo draft; removing the photo deletes the stored copy.
  useEffect(() => {
    if (!cprImage) {
      if (phase === "form" && !restoringPhoto.current) safeRemove(DRAFT_PHOTO_KEY);
      return;
    }
    if (phase !== "form") return;
    let cancelled = false;
    const type = (PHOTO_TYPES as readonly string[]).includes(cprImage.type)
      ? (cprImage.type as (typeof PHOTO_TYPES)[number])
      : "image/jpeg";
    void cprImage.arrayBuffer().then(
      (buf) => {
        if (cancelled) return;
        const raw = serializeDraftPhoto(new Uint8Array(buf), type, eventDate, Date.now());
        if (raw === null) safeRemove(DRAFT_PHOTO_KEY);
        else {
          safeRemove(DRAFT_PHOTO_KEY);
          safeSet(DRAFT_PHOTO_KEY, raw);
        }
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [phase, cprImage, eventDate]);

  // Moves focus only after a step change or a failed Next, never on the first render.
  useEffect(() => {
    if (!focusReq) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
    let el: HTMLElement | null = null;
    if (focusReq.target === "intro") el = document.getElementById("intro-title");
    else if (focusReq.target === "heading") el = document.getElementById(`step-${focusReq.step}-title`);
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
    setStepId(to);
    requestFocus(target, to, id);
  }

  function set<K extends keyof Values>(key: K, value: Values[K]) {
    setSubmissionId(null);
    setV((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  const dobParts = { day: v.dobDay, month: v.dobMonth, year: v.dobYear };
  const dobComposed = composeDob(dobParts);
  const dobShown = dobPartsError(dobParts) === null && isRealDate(dobComposed);
  const age = dobShown ? ageOn(dobComposed, eventDate) : null;
  const ageYoung = age !== null && age < AGE_MIN;
  const ageOld = age !== null && age > AGE_MAX;
  const ex = dobExample(eventDate);

  /** Every field's current error, from the mode's client schema plus the photo rule. */
  function validateAll(): Record<string, string> {
    const input = {
      ...(walkIn ? {} : { slotId: v.slotId === "" ? undefined : Number(v.slotId) }),
      fullName: v.fullName,
      cpr: v.cpr,
      dob: dobComposed,
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
    const pe = dobPartsError(dobParts);
    if (pe) next.dob = pe;
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
      navigated.current = true;
      setDirection("forward");
      go("review", "heading");
      return;
    }
    navigated.current = true;
    setDirection("forward");
    const next = steps[stepIndex + 1];
    if (next) go(next, step === "name" || step === "identity" || step === "contact" ? "field" : "heading");
  }

  function back() {
    navigated.current = true;
    setDirection("back");
    const prev = steps[stepIndex - 1];
    if (!prev) {
      setPhase("intro");
      requestFocus("intro", step);
      return;
    }
    setReturnToReview(false);
    go(prev, "heading");
  }

  function change(to: StepId) {
    navigated.current = true;
    setDirection(steps.indexOf(to) < stepIndex ? "back" : "forward");
    setReturnToReview(true);
    go(to, "heading");
  }

  /** The intro's primary button: Register starts at the first step, Continue restores the saved draft. */
  function startForm() {
    navigated.current = true;
    setDirection("forward");
    let first: StepId = steps[0] ?? "name";
    if (hasDraft) {
      const now = nowMs();
      const draft = parseDraft(draftRaw, { eventDate, walkIn, now });
      if (draft) {
        const slotOk = slots.some((o) => String(o.id) === draft.values.slotId && o.booked < o.capacity);
        setV((prev) => ({
          ...prev,
          ...draft.values,
          slotId: slotOk ? draft.values.slotId : "",
          bloodType: draft.values.bloodType || "unknown",
        }));
        setSubmissionId(draft.submissionId);
        first = steps.includes(draft.step) ? draft.step : first;
        setRestoredNotice(dict.join.draft_restored);
        const photo = parseDraftPhoto(safeGet(DRAFT_PHOTO_KEY), { eventDate, now });
        if (photo) {
          const buf = new Uint8Array(photo.bytes).buffer;
          restoringPhoto.current = true;
          cprField.current?.pick(new File([buf], "cpr.jpg", { type: photo.type }));
        } else if (draft.hadPhoto) {
          setRestoredNotice(dict.join.draft_restored + " " + dict.join.draft_photo_again);
        }
      }
    }
    setPhase("form");
    setStepId(first);
    requestFocus("heading", first);
  }

  function startOver() {
    safeRemove(DRAFT_KEY);
    safeRemove(DRAFT_PHOTO_KEY);
    navigated.current = true;
    setRestoredNotice("");
    setSubmissionId(null);
    setCprImage(null);
    setV((prev) => ({ ...prev, slotId: "", fullName: "", cpr: "", dobDay: "", dobMonth: "", dobYear: "", phone: "", email: "", bloodType: "unknown", recentDonation: "", onMedication: "" }));
    setDirection("forward");
    const first = steps[0] ?? "name";
    setPhase("form");
    setStepId(first);
    requestFocus("heading", first);
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
    setRetryable(false);
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
    const failed = (message: string, canRetry = false) => {
      setFormError(message);
      setRetryable(canRetry);
      turnstile.current?.reset();
    };
    const sid = submissionId ?? crypto.randomUUID();
    setSubmissionId(sid);
    try {
      for (let attempt = 0; attempt <= MAX_AUTO_RETRIES; attempt++) {
        const tk = tokenRef.current || (await waitForToken(TOKEN_WAIT_MS));
        if (!tk) {
          failed(dict.errors.turnstile_wait, true);
          reportClientError({ code: "turnstile_timeout", step: "review", attempt, locale });
          return;
        }
        const payload = {
          ...(walkIn ? {} : { slotId: Number(v.slotId) }),
          fullName: v.fullName,
          cpr: v.cpr,
          dob: dobComposed,
          phone: v.phone,
          email: v.email,
          bloodType: v.bloodType,
          recentDonation: v.recentDonation === "yes",
          onMedication: v.onMedication === "yes",
          consent: v.consent,
          token: tk,
          submissionId: sid,
        };
        // The public form always sends multipart; the photo part is present when a photo was attached.
        const fd = new FormData();
        fd.set("payload", JSON.stringify(payload));
        if (cprImage) fd.set("cprImage", cprImage, "cpr.jpg");
        type Json = {
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
        let status = 0;
        let json: Json = {};
        let outcome: ReturnType<typeof classifySubmit>;
        try {
          const res = await fetch("/api/signup", {
            method: "POST",
            body: fd,
            signal: AbortSignal.timeout(SUBMIT_TIMEOUT_MS),
          });
          status = res.status;
          json = (await res.json().catch(() => ({}))) as Json;
          outcome = classifySubmit({ status, json });
        } catch {
          outcome = classifySubmit({ networkError: true });
        }
        // The token is single use: it is spent whatever the outcome.
        tokenRef.current = "";

        if (outcome.kind === "success") {
          try {
            if (json.card) sessionStorage.setItem(CARD_TOKEN_KEY, json.card);
          } catch {
            // Storage blocked (private mode): the success page just hides the download button.
          }
          safeRemove(DRAFT_KEY);
          safeRemove(DRAFT_PHOTO_KEY);
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

        if (outcome.kind === "retryable") {
          if (attempt < MAX_AUTO_RETRIES) {
            turnstile.current?.reset();
            setRetryInfo({ n: attempt + 1, total: MAX_AUTO_RETRIES });
            await new Promise((r) => setTimeout(r, retryDelay(attempt)));
            continue;
          }
          failed(outcome.reason === "network" ? dict.errors.network : dict.errors.server, true);
          reportClientError({
            code:
              outcome.reason === "network"
                ? "submit_network"
                : outcome.reason === "server"
                  ? "submit_server"
                  : "submit_bad_response",
            step: "review",
            status: outcome.status,
            attempt,
            locale,
          });
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
        return;
      }
    } finally {
      clearTimeout(slowTimer.current);
      setSubmitting(false);
      setSlow(false);
      setRetryInfo(null);
    }
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!hydrated || submitting) return;
    if (phase === "intro") startForm();
    else if (step === "review") void submit();
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

  const sectionCls = (id: StepId) => {
    void id;
    return "space-y-4";
  };
  const active = (id: StepId) => (phase === "form" && step === id) || undefined;

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
        className="rounded-xl border-2 border-danger bg-danger-tint p-4 focus:outline-none"
      >
        <h3 id={`err-${forStep}-title`} className="font-bold text-danger-dark">
          {dict.join.error_summary_title}
        </h3>
        <ul className="mt-2 list-disc ps-5 text-sm text-danger-dark">
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
    phase === "intro"
      ? hasDraft
        ? dict.join.continue
        : dict.join.register
      : step === "review"
      ? submitting
        ? dict.join.saving
        : dict.join.submit
      : returnToReview
        ? dict.join.review_return
        : dict.join.next;

  const pct = `${((stepIndex + 1) / steps.length) * 100}%`;
  return (
    <div className="flex min-h-dvh flex-col">
      <TopBar locale={locale} languageLabel={dict.common.language} brand={dict.common.appTitle}>
        {phase === "form" && (
          <div className="flex items-center gap-3">
            <div aria-hidden="true" className="h-1.5 flex-1 overflow-hidden rounded-full bg-paper-2">
              <div
                className="h-full rounded-full bg-brand transition-[width] duration-300 ease-out motion-reduce:transition-none"
                style={{ width: pct }}
              />
            </div>
            <p aria-live="polite" aria-atomic="true" className="shrink-0 text-xs font-medium text-ink-soft tabular-nums">
              {t(dict.join.step_of, { n: stepIndex + 1, total: steps.length })}
            </p>
          </div>
        )}
      </TopBar>
      <form ref={formRef} noValidate onSubmit={onSubmit} aria-busy={submitting} className="flex flex-1 flex-col">
        <main ref={mainRef} id="main" className="mx-auto w-full max-w-xl flex-1 px-4 pt-6 pb-8">
      {/* A real box, not display:contents: the form's spacing only reaches its own children, and gap skips hidden steps. */}
      <fieldset disabled={!hydrated} className="flex min-w-0 flex-col gap-6">
        {!hydrated && (
          <p role="status" className="text-sm text-ink-soft">
            {dict.join.loading}
          </p>
        )}

        <div hidden={phase !== "intro"} data-active-step={phase === "intro" || undefined}>
          <EventIntro dict={dict} event={event} walkIn={walkIn} />
          {hasDraft && (
            <button type="button" className={btnChangeCls + " mt-4"} onClick={startOver}>
              {dict.join.draft_start_over}
            </button>
          )}
        </div>
        {phase === "form" && <h1 className="sr-only">{event.name}</h1>}
        {restoredNotice && phase === "form" && (
          <p role="status" className="rounded-xl bg-brand-tint p-3 text-sm">
            {restoredNotice}
          </p>
        )}
        {walkIn && phase === "form" && <p className="rounded-xl bg-brand-tint p-3 text-sm">{dict.join.walk_in_notice}</p>}

        {!walkIn && (
          <section aria-labelledby="step-slot-title" hidden={phase !== "form" || step !== "slot"} data-active-step={active("slot")} className={sectionCls("slot")}>
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

        <section aria-labelledby="step-name-title" hidden={phase !== "form" || step !== "name"} data-active-step={active("name")} className={sectionCls("name")}>
          {step === "name" && summary("name")}
          <h2 id="step-name-title" tabIndex={-1} className={headingCls}>
            <label htmlFor="f-fullName">{dict.join.q_name}</label>
          </h2>
          <input
            id="f-fullName"
            className={inputCls}
            autoComplete="name"
            enterKeyHint="next"
            placeholder={dict.join.ph_full_name}
            value={v.fullName}
            maxLength={150}
            onChange={(e) => set("fullName", e.target.value)}
            aria-required="true"
            aria-invalid={!!errors.fullName}
            aria-describedby={desc(errors.fullName && "f-fullName-error")}
          />
          {fieldError("fullName")}
        </section>

        <section aria-labelledby="step-identity-title" hidden={phase !== "form" || step !== "identity"} data-active-step={active("identity")} className={sectionCls("identity")}>
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
              enterKeyHint="next"
              placeholder="880000000"
              dir="ltr"
              value={v.cpr}
              pattern="[0-9]{9}"
              onChange={(e) => {
                const el = e.target;
                const value = cprInput(el.value);
                const atEnd = el.selectionStart === el.value.length;
                set("cpr", value);
                if (shouldAdvance(value, v.cpr, 9, atEnd)) dobRef.current?.focus();
              }}
              onBlur={(e) => markLength("cpr", cprInput(e.currentTarget.value), 9, "cpr_invalid")}
              aria-required="true"
              aria-invalid={!!errors.cpr}
              aria-describedby={desc(errors.cpr && "f-cpr-error")}
            />
            {fieldError("cpr")}
          </div>
          <fieldset
            id="f-dob"
            aria-describedby={desc("f-dob-hint", (ageYoung || ageOld) && "f-dob-age", errors.dob && "f-dob-error")}
          >
            <legend className={labelCls}>{dict.join.dob}</legend>
            <p id="f-dob-hint" className="mb-2 text-sm text-ink-soft">
              {t(dict.join.dob_hint, { example: `${ex.day} ${ex.month} ${ex.year}` })}
            </p>
            <div className="flex gap-3">
              {(
                [
                  ["day", "dobDay", dict.join.dob_day, "w-16", 2, "bday-day", ex.day],
                  ["month", "dobMonth", dict.join.dob_month, "w-16", 2, "bday-month", ex.month],
                  ["year", "dobYear", dict.join.dob_year, "w-24", 4, "bday-year", ex.year],
                ] as const
              ).map(([part, key, label, width, max, ac, ph]) => (
                <div key={part}>
                  <label htmlFor={`f-dob-${part}`} className="mb-1 block text-sm text-ink-soft">
                    {label}
                  </label>
                  <input
                    id={`f-dob-${part}`}
                    ref={part === "day" ? dobRef : part === "month" ? dobMonthRef : dobYearRef}
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    dir="ltr"
                    enterKeyHint="next"
                    maxLength={max}
                    autoComplete={ac}
                    placeholder={ph}
                    className={(inputCls + " text-center").replace("w-full", width)}
                    value={v[key]}
                    onChange={(e) => {
                      const el = e.target;
                      const value = cleanDobPart(el.value, max);
                      const atEnd = el.selectionStart === el.value.length;
                      set(key, value);
                      if (shouldAdvance(value, v[key], max, atEnd)) {
                        if (part === "day") dobMonthRef.current?.focus();
                        else if (part === "month") dobYearRef.current?.focus();
                      }
                    }}
                    aria-required="true"
                    aria-invalid={!!errors.dob}
                  />
                </div>
              ))}
              <div className="relative size-14 shrink-0 self-end has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand">
                <span
                  aria-hidden="true"
                  className="flex size-14 items-center justify-center rounded-xl border-2 border-line-strong bg-white text-brand"
                >
                  <CalendarDays className="size-6" aria-hidden="true" />
                </span>
                <input
                  type="date"
                  id="f-dob-picker"
                  aria-label={dict.join.dob_picker}
                  dir="ltr"
                  min="1900-01-01"
                  max={eventDate}
                  value={dobShown ? dobComposed : ""}
                  className="absolute inset-0 size-full cursor-pointer opacity-0"
                  onClick={(e) => {
                    try {
                      e.currentTarget.showPicker?.();
                    } catch {
                      /* unsupported or not user-activated */
                    }
                  }}
                  onChange={(e) => {
                    const parts = isoToDobParts(e.target.value);
                    if (!parts) return;
                    setSubmissionId(null);
                    setV((prev) => ({ ...prev, dobDay: parts.day, dobMonth: parts.month, dobYear: parts.year }));
                    setErrors((prev) => {
                      if (!("dob" in prev)) return prev;
                      const next = { ...prev };
                      delete next.dob;
                      return next;
                    });
                  }}
                />
              </div>
            </div>
            <p
              id="f-dob-age"
              aria-live="polite"
              className={
                ageYoung || ageOld ? "mt-2 rounded-md bg-flag-bg px-3 py-1.5 text-sm text-flag-ink" : undefined
              }
            >
              {ageYoung
                ? t(dict.join.age_young, { age, min: AGE_MIN })
                : ageOld
                  ? t(dict.join.age_old, { age, max: AGE_MAX })
                  : null}
            </p>
            {fieldError("dob")}
          </fieldset>
        </section>

        <section aria-labelledby="step-contact-title" hidden={phase !== "form" || step !== "contact"} data-active-step={active("contact")} className={sectionCls("contact")}>
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
              enterKeyHint="next"
              placeholder="3XXXXXXX"
              dir="ltr"
              value={v.phone}
              onChange={(e) => {
                const el = e.target;
                const value = phoneInput(el.value);
                const atEnd = el.selectionStart === el.value.length;
                set("phone", value);
                if (shouldAdvance(value, v.phone, 8, atEnd)) emailRef.current?.focus();
              }}
              onBlur={(e) => markLength("phone", phoneInput(e.currentTarget.value), 8, "phone_invalid")}
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
              ref={emailRef}
              type="email"
              className={inputCls}
              autoComplete="email"
              enterKeyHint="next"
              placeholder="name@example.com"
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
          hidden={phase !== "form" || step !== "bloodType"}
          data-active-step={active("bloodType")}
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

        <section aria-labelledby="step-photo-title" hidden={phase !== "form" || step !== "photo"} data-active-step={active("photo")} className={sectionCls("photo")}>
          {step === "photo" && summary("photo")}
          <CprImageField
            dict={dict}
            value={cprImage}
            ref={cprField}
            asHeading
            label={photoLabel}
            hint={walkIn ? dict.join.cpr_image_hint_walk_in : undefined}
            required={photoRequired(walkIn)}
            onChange={(b) => {
              setCprImage(b);
              if (!restoringPhoto.current) setSubmissionId(null);
              if (b) restoringPhoto.current = false;
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
          hidden={phase !== "form" || step !== "screening"}
          data-active-step={active("screening")}
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

        <section aria-labelledby="step-review-title" hidden={phase !== "form" || step !== "review"} data-active-step={active("review")} className={sectionCls("review")}>
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
              row(dict.join.dob, dobShown ? formatDate(dobComposed, locale) : `${v.dobDay}/${v.dobMonth}/${v.dobYear}`),
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
                className="mt-0.5 size-5 shrink-0 accent-brand"
                aria-required="true"
                aria-invalid={!!errors.consent}
                aria-describedby={desc(errors.consent && "f-consent-error")}
              />
              <span>
                {consentParts[0]}
                <Link href={`/${locale}/privacy`} className="text-brand underline underline-offset-4 hover:decoration-2">
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
            <div role="alert" className="rounded-xl border border-danger bg-danger-tint px-4 py-3 text-sm text-danger-dark">
              <p>{formError}</p>
              {retryable && (
                <button type="button" className={btnSecondary + " mt-3"} onClick={() => void submit()}>
                  {dict.join.retry}
                </button>
              )}
            </div>
          )}
        </section>

      </fieldset>
        </main>
        <div
          className="sticky bottom-0 z-30 border-t border-line bg-paper/95 backdrop-blur"
          style={{ transform: kb ? `translateY(-${kb}px)` : undefined }}
        >
          <div className="mx-auto flex max-w-xl items-center gap-3 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            {phase === "form" && (
              <button type="button" className={btnSecondary + " basis-1/3"} onClick={back} disabled={submitting}>
                <ArrowLeft className="size-5 rtl:rotate-180" aria-hidden="true" />
                {dict.common.back}
              </button>
            )}
            <button
              type="submit"
              className={btnPrimary + " flex-1"}
              disabled={!hydrated || submitting || (phase === "form" && imageBusy && (step === "photo" || step === "review"))}
            >
              {submitting && <Loader2 className="size-5 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
              {primaryLabel}
              {!submitting && (phase === "intro" || step !== "review") && (
                <ArrowRight className="size-5 rtl:rotate-180" aria-hidden="true" />
              )}
            </button>
            {phase === "form" && (
              <span aria-hidden="true" className="hidden text-sm text-ink-soft sm:inline">
                {dict.join.enter_hint}
              </span>
            )}
          </div>
          <p aria-live="polite" className="mx-auto max-w-xl px-4 pb-2 text-center text-xs text-ink-soft empty:hidden">
            {retryInfo ? t(dict.join.retrying, retryInfo) : slow ? dict.join.slow : ""}
          </p>
        </div>
      </form>
    </div>
  );
}
