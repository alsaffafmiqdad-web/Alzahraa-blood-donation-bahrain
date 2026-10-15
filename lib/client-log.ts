/*
 * Browser only. Reports a failure code to /api/client-log. May carry the typed name, email and phone
 * (self-reported by the browser, unverified) so the organisers can follow up. Never the CPR or DOB.
 */
import type { ClientErrorCode } from "@/lib/alert-format";

export type ClientErrorReport = {
  code: ClientErrorCode;
  step?: string;
  status?: number;
  attempt?: number;
  locale?: string;
  person?: { name?: string; email?: string; phone?: string };
};

const MAX_REPORTS = 5;
let sent = 0;

export function reportClientError(r: ClientErrorReport): void {
  try {
    if (sent >= MAX_REPORTS) return;
    sent += 1;
    const body = JSON.stringify(r);
    const ok =
      typeof navigator !== "undefined" &&
      typeof navigator.sendBeacon === "function" &&
      navigator.sendBeacon("/api/client-log", new Blob([body], { type: "application/json" }));
    if (!ok) {
      void fetch("/api/client-log", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
        keepalive: true,
      }).catch(() => undefined);
    }
  } catch {
    // Reporting must never break the form.
  }
}
