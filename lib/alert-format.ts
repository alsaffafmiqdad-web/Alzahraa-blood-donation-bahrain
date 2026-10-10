/* Isomorphic and pure: formats Discord alert messages. Never put personal data in an alert. */
import { toAsciiDigits } from "@/lib/cpr";

export const ALERT_EVENTS = [
  "signup_error",
  "signup_rate_limited",
  "cpr_upload_failed",
  "card_token_failed",
  "join_load_failed",
  "email_failed",
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

export type Alert = { event: AlertEvent; donorId?: string; code?: string; detail?: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_CONTENT = 1900;

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

export function formatAlert(
  a: Alert,
  envLabel: string,
  suppressed: number,
): { content: string; allowed_mentions: { parse: [] } } {
  const lines = [`**[${redact(envLabel, 20)}] ${a.event}**`];
  if (a.code) lines.push(`code: ${redact(a.code, 60)}`);
  if (a.donorId && UUID_RE.test(a.donorId)) lines.push(`donor: ${a.donorId}`);
  if (a.detail) lines.push(`detail: ${redact(a.detail)}`);
  if (suppressed > 0) lines.push(`suppressed since last: ${suppressed}`);
  return { content: lines.join("\n").slice(0, MAX_CONTENT), allowed_mentions: { parse: [] } };
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
};

/** One notice per signup request. Carries no personal data: codes, mode, donor UUID and queue number only. */
export function formatSubmission(
  n: SubmissionNotice,
  envLabel: string,
  suppressed: number,
): { content: string; allowed_mentions: { parse: [] } } {
  const env = redact(envLabel, 20);
  const ok = n.outcome === "success" || n.outcome === "replay";
  const lines = [ok ? `**[${env}] signup ok**` : `**[${env}] signup failed: ${redact(n.outcome, 40)}**`];
  if (n.outcome === "replay") lines.push("outcome: replay");
  if (n.mode === "slot" || n.mode === "walk_in") lines.push(`mode: ${n.mode}`);
  if (n.donorId && UUID_RE.test(n.donorId)) lines.push(`donor: ${n.donorId}`);
  if (typeof n.queueNumber === "number" && Number.isFinite(n.queueNumber)) lines.push(`queue: ${Math.trunc(n.queueNumber)}`);
  if (n.fields) {
    const entries = Object.entries(n.fields)
      .slice(0, 10)
      .map(([k, v]) => `${redact(k, 40)}=${redact(String(v), 40)}`);
    if (entries.length > 0) lines.push(`fields: ${entries.join(", ")}`);
  }
  if (suppressed > 0) lines.push(`suppressed since last: ${suppressed}`);
  return { content: lines.join("\n").slice(0, MAX_CONTENT), allowed_mentions: { parse: [] } };
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
