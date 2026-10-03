import "server-only";
import { EMAIL_CONCURRENCY } from "@/lib/config";
import { claimEmailSend, finishEmailSend, getDonorForEmail } from "@/lib/db/email";
import { emailDailyBudget, orgInfo, resendConfig } from "@/lib/env";
import { sendConfirmationEmail } from "@/lib/email/send";
import { shortRef } from "@/lib/format";
import { renderDonorCard } from "@/lib/pdf/render";

export type EmailOutcome = "sent" | "queued" | "failed" | "none";

/**
 * Sends the bilingual confirmation email with the donor card PDF.
 * Never throws. Logs only the donor id and the error message.
 */
export async function sendDonorEmail(donorId: string): Promise<EmailOutcome> {
  let claimId: number | null = null;
  try {
    const donor = await getDonorForEmail(donorId);
    if (!donor || !donor.email) return "none";
    if (!resendConfig()) {
      console.warn(`email skipped donor=${donorId}: Resend is not configured`);
      return "queued";
    }
    claimId = await claimEmailSend(donorId, emailDailyBudget());
    if (claimId === null) return "queued";

    const data = {
      fullName: donor.fullName,
      ref: shortRef(donor.id),
      bloodType: donor.bloodType,
      slotTime: donor.slotTime,
      signupDate: donor.createdAt,
      event: donor.event,
      org: orgInfo(),
    };
    const pdf = await renderDonorCard(data);
    const result = await sendConfirmationEmail({ ...data, emailTo: donor.email }, pdf);
    await finishEmailSend(claimId, result.ok, result.ok ? null : result.error);
    claimId = null;
    if (!result.ok) console.error(`email error donor=${donorId}: ${result.error}`);
    return result.ok ? "sent" : "failed";
  } catch (e) {
    const message = e instanceof Error ? e.message : "unknown";
    console.error(`email error donor=${donorId}: ${message}`);
    if (claimId !== null) {
      try {
        await finishEmailSend(claimId, false, message);
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
};

/**
 * Sends to up to `limit` pending donors, `concurrency` at a time. Stops starting new sends when a send
 * reports the budget is used up, or when the deadline passes; in-flight sends finish.
 */
export async function runEmailRetry(
  deps: RetryDeps,
  limit: number,
  { concurrency = EMAIL_CONCURRENCY, deadline, now = Date.now }: RetryOptions = {},
): Promise<RetryResult> {
  const result: RetryResult = { attempted: 0, sent: 0, failed: 0, stoppedForBudget: false, stoppedForTime: false };
  if (limit <= 0) {
    result.stoppedForBudget = true;
    return result;
  }
  const ids = (await deps.listCandidates(limit)).slice(0, limit);
  let next = 0;
  const worker = async () => {
    while (next < ids.length && !result.stoppedForBudget) {
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
      if (outcome === "sent") result.sent += 1;
      else if (outcome === "failed") result.failed += 1;
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, ids.length)) }, worker));
  return result;
}
