import "server-only";
import { after } from "next/server";
import { createAlertGate, formatAlert, formatSubmission, type Alert, type SubmissionNotice } from "@/lib/alert-format";

const gate = createAlertGate();
// Submission notices are not deduplicated; they are only capped per minute.
const submissionGate = createAlertGate({ dedupMs: 0, maxPerMinute: 25 });

const WEBHOOK_RE = /^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\//;

function dispatch(url: string, body: unknown): void {
  const send = () =>
    fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(3000),
    }).then(
      () => undefined,
      () => undefined,
    );
  try {
    after(send);
  } catch {
    void send(); // after() throws outside a request scope
  }
}

/** Fire-and-forget. Never throws, never awaited by callers, never delays a response. */
export function reportAlert(a: Alert): void {
  try {
    const url = process.env.DISCORD_WEBHOOK_URL;
    if (!url || !WEBHOOK_RE.test(url)) return;
    const verdict = gate.allow(`${a.event}:${a.code ?? ""}`);
    if (!verdict.ok) return;
    const envLabel = process.env.VERCEL_ENV ?? "local";
    dispatch(url, formatAlert(a, envLabel, verdict.suppressed));
  } catch {
    // Alerts must never break the caller.
  }
}

/** One notice per signup request. Same webhook, own gate (no dedup, 25 a minute). Never throws. */
export function reportSubmission(n: SubmissionNotice): void {
  try {
    const url = process.env.DISCORD_WEBHOOK_URL;
    if (!url || !WEBHOOK_RE.test(url)) return;
    const verdict = submissionGate.allow("submission");
    if (!verdict.ok) return;
    const envLabel = process.env.VERCEL_ENV ?? "local";
    dispatch(url, formatSubmission(n, envLabel, verdict.suppressed));
  } catch {
    // Notices must never break the caller.
  }
}
