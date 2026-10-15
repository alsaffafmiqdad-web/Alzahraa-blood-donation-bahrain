/*
 * Isomorphic and pure: formats Discord alert messages. Alerts may carry the donor's name, email and
 * phone so a failed signup can be traced (owner decision). They never carry the CPR, DOB, screening
 * answers, notes or the photo. Free-text `detail`, `code` and `fields` are still redacted.
 */
import { toAsciiDigits } from "@/lib/cpr";
import type { Status } from "@/lib/donor-filters";

export const ALERT_EVENTS = [
  "signup_error",
  "signup_rate_limited",
  "cpr_upload_failed",
  "card_token_failed",
  "join_load_failed",
  "email_failed",
  "email_auth_failed",
  "email_not_configured",
  "cron_step_failed",
  "cron_email_summary",
  "client_error",
] as const;
export type AlertEvent = (typeof ALERT_EVENTS)[number];

export const CLIENT_ERROR_CODES = [
  "submit_network",
  "submit_server",
  "submit_bad_response",
  "turnstile_timeout",
  "image_prepare_failed",
] as const;
export type ClientErrorCode = (typeof CLIENT_ERROR_CODES)[number];

export type AlertPerson = { name?: string | null; email?: string | null; phone?: string | null };
export const PERSON_MAX = { name: 150, email: 254, phone: 20 } as const;

export type Alert = {
  event: AlertEvent;
  donorId?: string;
  code?: string;
  detail?: string;
  person?: AlertPerson;
  where?: string; // static route name such as "/join", never a full URL
};

const DETAIL_MAX = 300;
const NETWORK_RE = /\b(ECONNREFUSED|ENOTFOUND|ETIMEDOUT|UND_ERR_[A-Z_]+)\b|fetch failed/;
const NETWORK_EVENTS: readonly AlertEvent[] = ["join_load_failed", "signup_error", "cron_step_failed", "cpr_upload_failed"];
const NETWORK_HINT =
  "hint: can't reach Supabase. Locally, run `pnpm dlx supabase start`; on Vercel, check NEXT_PUBLIC_SUPABASE_URL and status.supabase.com.";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_CONTENT = 1900;

/** Collapses whitespace and control characters, turns backticks into ', trims, caps length. Does NOT redact. */
export function cleanContact(s: string, max: number): string {
  return s
    .replace(/[\p{Cc}\s]+/gu, " ")
    .replace(/`/g, "'")
    .trim()
    .slice(0, max)
    .trim();
}

/** Best-effort person from an unvalidated signup payload: name, email and phone strings only. Never reads cpr or dob. */
export function personFromPayload(raw: unknown): AlertPerson | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const r = raw as Record<string, unknown>;
  const out: AlertPerson = {};
  const pick = (v: unknown, max: number): string | undefined => {
    if (typeof v !== "string") return undefined;
    const c = cleanContact(v, max);
    return c || undefined;
  };
  const name = pick(r.fullName, PERSON_MAX.name);
  const email = pick(r.email, PERSON_MAX.email);
  const phone = pick(r.phone, PERSON_MAX.phone);
  if (name) out.name = name;
  if (email) out.email = email;
  if (phone) out.phone = phone;
  return Object.keys(out).length > 0 ? out : undefined;
}

/** The admin page link for a donor, only for a UUID and a valid http(s) site URL. */
function adminLink(donorId: string | undefined, siteUrl: string): string | undefined {
  if (!donorId || !UUID_RE.test(donorId) || !siteUrl) return undefined;
  try {
    const u = new URL(siteUrl);
    if (u.protocol !== "http:" && u.protocol !== "https:") return undefined;
    return `${u.origin}/admin/donors/${donorId}`;
  } catch {
    return undefined;
  }
}

/**
 * The cleaned, non-empty value of one person field in an inline code span, or undefined. Discord
 * shows a code span literally (no links, bold or mentions) and cleanContact already turned any
 * backtick into ', so a value cannot close the span.
 */
function personField(p: AlertPerson | undefined, key: keyof AlertPerson): string | undefined {
  const v = p?.[key];
  if (typeof v !== "string") return undefined;
  const c = cleanContact(v, PERSON_MAX[key]);
  return c ? `\`${c}\`` : undefined;
}

/** Discord message flag SUPPRESS_EMBEDS: no link previews for anything in the message. */
const SUPPRESS_EMBEDS = 4;

type Payload = { content: string; allowed_mentions: { parse: [] }; flags: 4 };

/** Removes anything that looks like personal data and neutralises Discord mentions. */
export function redact(s: string, max = 200): string {
  return toAsciiDigits(s)
    .replace(/[^\s@]+@[^\s@]+/g, "[email]")
    .replace(/\d{6,}/g, "[digits]")
    .replace(/`/g, "'")
    .replace(/@/g, " at ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

const HINTS: Partial<Record<AlertEvent, string>> = {
  email_auth_failed:
    "action: Gmail rejected the login, so no email can be sent. Make a new app password, update GMAIL_APP_PASSWORD in Vercel and redeploy. See docs/operations.md.",
};

export function formatAlert(
  a: Alert,
  envLabel: string,
  suppressed: number,
  siteUrl = "",
): Payload {
  const lines = [`🚨 **[${redact(envLabel, 20)}] ${a.event}**`];
  if (a.code) lines.push(`code: ${redact(a.code, 60)}`);
  if (a.donorId && UUID_RE.test(a.donorId)) lines.push(`🆔 donor: ${a.donorId}`);
  const name = personField(a.person, "name");
  const email = personField(a.person, "email");
  const phone = personField(a.person, "phone");
  if (name) lines.push(`👤 name: ${name}`);
  if (email) lines.push(`📧 email: ${email}`);
  if (phone) lines.push(`📱 phone: ${phone}`);
  const admin = adminLink(a.donorId, siteUrl);
  if (admin) lines.push(`🔗 admin: ${admin}`);
  if (a.where) lines.push(`where: ${redact(a.where, 60)}`);
  if (a.detail) lines.push(`detail: ${redact(a.detail, DETAIL_MAX)}`);
  const hint =
    HINTS[a.event] ?? (a.detail && NETWORK_EVENTS.includes(a.event) && NETWORK_RE.test(a.detail) ? NETWORK_HINT : undefined);
  if (hint) lines.push(hint);
  if (suppressed > 0) lines.push(`suppressed since last: ${suppressed}`);
  return { content: lines.join("\n").slice(0, MAX_CONTENT), allowed_mentions: { parse: [] }, flags: SUPPRESS_EMBEDS };
}

export const SUBMISSION_OUTCOMES = [
  "success",
  "replay",
  "validation",
  "turnstile",
  "rate_limited",
  "registration_closed",
  "duplicate_cpr",
  "slot_full",
  "slot_unavailable",
  "too_large",
  "bad_json",
  "unsupported_media_type",
  "server",
] as const;
export type SubmissionOutcome = (typeof SUBMISSION_OUTCOMES)[number];

export type SubmissionNotice = {
  outcome: SubmissionOutcome;
  mode?: "slot" | "walk_in";
  donorId?: string; // UUID only, dropped unless UUID_RE matches
  queueNumber?: number | null;
  fields?: Record<string, string>; // field key -> error code, never values
  person?: AlertPerson; // name, email and phone only
  total?: number; // donors registered so far (success only)
  status?: Status; // the new donor's status (success only)
};

export const STATUS_EMOJI: Record<Status, string> = {
  registered: "📝",
  verified: "🪪",
  waiting: "⏳",
  screening: "🩺",
  donated: "🩸",
  deferred: "⏸️",
  no_show: "🚫",
};

/**
 * One notice per signup request. May carry the donor's name, email and phone for tracing, plus the
 * donor UUID, admin link, queue number, total and status. Never the CPR, DOB, answers or photo.
 */
export function formatSubmission(
  n: SubmissionNotice,
  envLabel: string,
  suppressed: number,
  siteUrl = "",
): Payload {
  const env = redact(envLabel, 20);
  const header =
    n.outcome === "success"
      ? `✅ **[${env}] signup ok**`
      : n.outcome === "replay"
        ? `🔁 **[${env}] signup ok** (replay)`
        : `❌ **[${env}] signup failed: ${redact(n.outcome, 40)}**`;
  const lines = [header];
  const success = n.outcome === "success";
  if (success && typeof n.total === "number" && Number.isInteger(n.total) && n.total >= 0) {
    lines.push(`👥 total: ${n.total}`);
  }
  const name = personField(n.person, "name");
  if (name) lines.push(`👤 name: ${name}`);
  if (success && n.status && Object.hasOwn(STATUS_EMOJI, n.status)) {
    lines.push(`${STATUS_EMOJI[n.status]} status: ${n.status}`);
  }
  if (typeof n.queueNumber === "number" && Number.isFinite(n.queueNumber)) lines.push(`🎟️ queue: ${Math.trunc(n.queueNumber)}`);
  if (n.mode === "slot") lines.push("🗓️ mode: slot");
  if (n.mode === "walk_in") lines.push("🚶 mode: walk_in");
  const email = personField(n.person, "email");
  const phone = personField(n.person, "phone");
  if (email) lines.push(`📧 email: ${email}`);
  if (phone) lines.push(`📱 phone: ${phone}`);
  if (n.donorId && UUID_RE.test(n.donorId)) lines.push(`🆔 donor: ${n.donorId}`);
  const admin = adminLink(n.donorId, siteUrl);
  if (admin) lines.push(`🔗 admin: ${admin}`);
  if (n.fields) {
    const entries = Object.entries(n.fields)
      .slice(0, 10)
      .map(([k, v]) => `${redact(k, 40)}=${redact(String(v), 40)}`);
    if (entries.length > 0) lines.push(`📝 fields: ${entries.join(", ")}`);
  }
  if (suppressed > 0) lines.push(`suppressed since last: ${suppressed}`);
  return { content: lines.join("\n").slice(0, MAX_CONTENT), allowed_mentions: { parse: [] }, flags: SUPPRESS_EMBEDS };
}

export function createAlertGate(opts: { dedupMs?: number; maxPerMinute?: number; now?: () => number } = {}) {
  const { dedupMs = 300_000, maxPerMinute = 10, now = () => Date.now() } = opts;
  const lastSent = new Map<string, number>();
  let windowStart = 0;
  let inWindow = 0;
  let suppressed = 0;
  return {
    allow(key: string): { ok: true; suppressed: number } | { ok: false } {
      const t = now();
      const last = lastSent.get(key);
      if (last !== undefined && t - last < dedupMs) {
        suppressed += 1;
        return { ok: false };
      }
      if (t - windowStart >= 60_000) {
        windowStart = t;
        inWindow = 0;
      }
      if (inWindow >= maxPerMinute) {
        suppressed += 1;
        return { ok: false };
      }
      inWindow += 1;
      lastSent.set(key, t);
      const n = suppressed;
      suppressed = 0;
      return { ok: true, suppressed: n };
    },
  };
}
