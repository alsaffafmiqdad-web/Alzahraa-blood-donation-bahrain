import "server-only";
import { after } from "next/server";
import { createAlertGate, formatAlert, type Alert } from "@/lib/alert-format";

const gate = createAlertGate();

/** Fire-and-forget. Never throws, never awaited by callers, never delays a response. */
export function reportAlert(a: Alert): void {
  try {
    const url = process.env.DISCORD_WEBHOOK_URL;
    if (!url || !/^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\//.test(url)) return;
    const verdict = gate.allow(`${a.event}:${a.code ?? ""}`);
    if (!verdict.ok) return;
    const envLabel = process.env.VERCEL_ENV ?? "local";
    const send = () =>
      fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(formatAlert(a, envLabel, verdict.suppressed)),
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
  } catch {
    // Alerts must never break the caller.
  }
}
