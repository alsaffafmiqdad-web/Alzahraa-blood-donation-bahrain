import "server-only";
import { reportAlert } from "@/lib/alert";
import { EMAIL_CONCURRENCY } from "@/lib/config";
import { claimEmailSend, finishEmailSend, getDonorForEmail, type DonorForEmail } from "@/lib/db/email";
import { describeError } from "@/lib/describe-error";
import { emailConfig, emailDailyBudget } from "@/lib/env";
import { isEmailAuthError } from "@/lib/email/errors";
import { sendConfirmationEmail } from "@/lib/email/send";
import { donorCardData, registrationFormData } from "@/lib/pdf/donor-card-pdf";
import { renderDonorCard } from "@/lib/pdf/render";

export type EmailOutcome = "sent" | "queued" | "failed" | "auth_failed" | "none";

/**
 * Sends the bilingual confirmation email with the donor card PDF.
 * Never throws. Logs only the donor id and the error message.
 */
export async function sendDonorEmail(donorId: string): Promise<EmailOutcome> {
  let claimId: number | null = null;
  let donor: DonorForEmail | null = null;
  const person = () => (donor ? { name: donor.fullName, email: donor.email, phone: donor.phone } : undefined);
  try {
    donor = await getDonorForEmail(donorId);
    if (!donor || !donor.email) return "none";
    if (!emailConfig()) {
      console.warn(`email skipped donor=${donorId}: email is not configured`);
      reportAlert({ event: "email_not_configured" });
      return "queued";
    }
    claimId = await claimEmailSend(donorId, emailDailyBudget());
    if (claimId === null) return "queued";

    const data = donorCardData(donor);
    const pdf = await renderDonorCard(registrationFormData(donor));
    const result = await sendConfirmationEmail({ ...data, emailTo: donor.email }, pdf);
    await finishEmailSend(claimId, result.ok, result.ok ? null : result.error);
    claimId = null;
    if (!result.ok) {
      console.error(`email error donor=${donorId}: ${result.error}`);
      if (isEmailAuthError(result.error)) {
        reportAlert({ event: "email_auth_failed", detail: result.error });
        return "auth_failed";
      }
      reportAlert({ event: "email_failed", donorId, detail: result.error, person: person() });
      return "failed";
    }
    return "sent";
  } catch (e) {
    const message = describeError(e);
    console.error(`email error donor=${donorId}: ${message}`);
    reportAlert({ event: "email_failed", donorId, detail: message, person: person() });
    if (claimId !== null) {
      try {
        await finishEmailSend(claimId, false, e instanceof Error ? e.message : "unknown");
      } catch {
        // The claim row stays 'claimed' and still counts against the budget. Acceptable.
      }
    }
    return "failed";
  }
}

export type RetryDeps = {
  listCandidates(limit: number): Promise<string[]>;
  send(donorId: string): Promise<EmailOutcome>;
};

export type RetryOptions = {
  /** Emails in flight at once. */
  concurrency?: number;
  /** Epoch ms. No new email is started after this; the rest are left for the next run. */
  deadline?: number;
  now?: () => number;
};

export type RetryResult = {
  attempted: number;
  sent: number;
  failed: number;
  stoppedForBudget: boolean;
  stoppedForTime: boolean;
  stoppedForAuth: boolean;
};

/**
 * Sends to up to `limit` pending donors, `concurrency` at a time. Stops starting new sends when a send
 * reports the budget is used up, when the email login is rejected, or when the deadline passes; in-flight
 * sends finish.
 */
export async function runEmailRetry(
  deps: RetryDeps,
  limit: number,
  { concurrency = EMAIL_CONCURRENCY, deadline, now = Date.now }: RetryOptions = {},
): Promise<RetryResult> {
  const result: RetryResult = { attempted: 0, sent: 0, failed: 0, stoppedForBudget: false, stoppedForTime: false,
    stoppedForAuth: false,
  };
  if (limit <= 0) {
    result.stoppedForBudget = true;
    return result;
  }
  const ids = (await deps.listCandidates(limit)).slice(0, limit);
  let next = 0;
  const worker = async () => {
    while (next < ids.length && !result.stoppedForBudget && !result.stoppedForAuth) {
      if (deadline !== undefined && now() >= deadline) {
        result.stoppedForTime = true;
        return;
      }
      const id = ids[next++]!;
      const outcome = await deps.send(id);
      if (outcome === "queued") {
        result.stoppedForBudget = true;
        return;
      }
      result.attempted += 1;
      if (outcome === "auth_failed") {
        result.failed += 1;
        result.stoppedForAuth = true;
        return;
      }
      if (outcome === "sent") result.sent += 1;
      else if (outcome === "failed") result.failed += 1;
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, ids.length)) }, worker));
  return result;
}
