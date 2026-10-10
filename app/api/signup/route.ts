import { NextResponse, after } from "next/server";
import { reportAlert, reportSubmission } from "@/lib/alert";
import type { SubmissionNotice } from "@/lib/alert-format";
import { createCardToken } from "@/lib/card-link";
import { MAX_SIGNUP_BODY_BYTES } from "@/lib/config";
import {
  MAX_CPR_IMAGE_BYTES,
  MULTIPART_SIGNUP_MAX_BYTES,
  sniffImageType,
  type CprImageExt,
} from "@/lib/cpr-image";
import { attachCprImage } from "@/lib/db/cpr-image";
import { findSubmission, getEvent, registerDonor } from "@/lib/db/public";
import { sendDonorEmail } from "@/lib/email/dispatch";
import { isWalkInMode } from "@/lib/event-mode";
import { shortRef } from "@/lib/format";
import { checkSignupRateLimit, clientIp, recordSignupAttempt } from "@/lib/rate-limit";
import { computeFlags } from "@/lib/screening";
import { verifyTurnstile } from "@/lib/turnstile";
import { signupSchema, signupWalkInSchema, type SignupInput } from "@/lib/validation";
import { en } from "@/lib/i18n/dictionaries/en";

export const runtime = "nodejs";
export const maxDuration = 60; // Budget covers the photo upload (CPR_IMAGE_DEADLINE_MS) and the email sent in after(); stays under SUBMIT_TIMEOUT_MS.

const ERROR_CODES = new Set(Object.keys(en.errors));

/** "sending": the email goes out in after(), once the response has been sent. */
type EmailStatus = "sent" | "sending" | "none";

function json(body: Record<string, unknown>, status: number, headers?: Record<string, string>) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

/** One Discord notice per request, whatever the outcome. `handle` sets `n` right before each return. */
export async function POST(req: Request) {
  const n: SubmissionNotice = { outcome: "server" };
  try {
    return await handle(req, n);
  } finally {
    reportSubmission(n);
  }
}

async function handle(req: Request, n: SubmissionNotice): Promise<Response> {
  try {
    const ip = clientIp(req);
    if (!(await checkSignupRateLimit(ip))) {
      reportAlert({ event: "signup_rate_limited" });
      n.outcome = "rate_limited";
      return json({ ok: false, error: "rate_limited" }, 429, { "Retry-After": "600" });
    }

    const contentType = (req.headers.get("content-type") ?? "").toLowerCase();
    let raw: unknown;
    let image: { bytes: Uint8Array; ext: CprImageExt } | null = null;
    let imageError: string | null = null;

    if (contentType.startsWith("application/json")) {
      const text = await req.text();
      if (text.length > MAX_SIGNUP_BODY_BYTES || Buffer.byteLength(text) > MAX_SIGNUP_BODY_BYTES) {
        n.outcome = "too_large";
        return json({ ok: false, error: "too_large" }, 413);
      }
      try {
        raw = JSON.parse(text);
      } catch {
        n.outcome = "bad_json";
        return json({ ok: false, error: "bad_json" }, 400);
      }
    } else if (contentType.startsWith("multipart/form-data")) {
      const length = Number(req.headers.get("content-length"));
      if (!req.headers.get("content-length") || !Number.isFinite(length) || length > MULTIPART_SIGNUP_MAX_BYTES) {
        n.outcome = "too_large";
        return json({ ok: false, error: "too_large" }, 413);
      }
      let form: FormData;
      try {
        form = await req.formData();
      } catch {
        n.outcome = "bad_json";
        return json({ ok: false, error: "bad_json" }, 400);
      }
      const payload = form.get("payload");
      if (typeof payload !== "string") {
        n.outcome = "bad_json";
        return json({ ok: false, error: "bad_json" }, 400);
      }
      if (Buffer.byteLength(payload) > MAX_SIGNUP_BODY_BYTES) {
        n.outcome = "too_large";
        return json({ ok: false, error: "too_large" }, 413);
      }
      try {
        raw = JSON.parse(payload);
      } catch {
        n.outcome = "bad_json";
        return json({ ok: false, error: "bad_json" }, 400);
      }
      const file = form.get("cprImage");
      if (file !== null) {
        if (typeof file === "string" || file.size === 0) {
          imageError = "cpr_image_invalid";
        } else if (file.size > MAX_CPR_IMAGE_BYTES) {
          imageError = "cpr_image_too_large";
        } else {
          const bytes = new Uint8Array(await file.arrayBuffer());
          const ext = sniffImageType(bytes);
          if (ext) image = { bytes, ext };
          else imageError = "cpr_image_invalid";
        }
      }
    } else {
      n.outcome = "unsupported_media_type";
      return json({ ok: false, error: "unsupported_media_type" }, 415);
    }
    const event = await getEvent();
    const walkIn = isWalkInMode(event, new Date());
    n.mode = walkIn ? "walk_in" : "slot";
    // Owner decisions B and W4: the photo is required in slot mode and optional in walk-in mode.
    if (!image && !imageError && !walkIn) imageError = "cpr_image_required";
    const parsed = (walkIn ? signupWalkInSchema : signupSchema).safeParse(raw);
    if (!parsed.success || imageError) {
      const fields: Record<string, string> = {};
      if (!parsed.success) {
        for (const issue of parsed.error.issues) {
          const key = issue.path.join(".") || "_";
          if (!(key in fields)) fields[key] = ERROR_CODES.has(issue.message) ? issue.message : "server";
        }
      }
      if (imageError) fields.cprImage = imageError;
      n.outcome = "validation";
      n.fields = fields;
      return json({ ok: false, error: "validation", fields }, 400);
    }
    const input = parsed.data;

    if (!(await verifyTurnstile(input.token, ip))) {
      n.outcome = "turnstile";
      return json({ ok: false, error: "turnstile" }, 403);
    }

    // Count the attempt only now: typos (Zod) and failed Turnstile checks never burn the quota.
    if (!(await recordSignupAttempt(ip))) {
      reportAlert({ event: "signup_rate_limited" });
      n.outcome = "rate_limited";
      return json({ ok: false, error: "rate_limited" }, 429, { "Retry-After": "600" });
    }

    // The success response, shared by the normal path and a replay of an earlier attempt.
    const success = (
      id: string,
      isWalkIn: boolean,
      slot: number | null,
      queueNumber: number | null,
      emailStatus: EmailStatus,
    ) => {
      // The card download is a convenience: if the token can't be made, the registration still succeeds.
      let card: string | undefined;
      try {
        card = createCardToken(id);
      } catch (e) {
        const message = e instanceof Error ? e.message : "unknown";
        console.error(`card token error donor=${id}: ${message}`);
        reportAlert({ event: "card_token_failed", donorId: id, detail: message });
      }
      const ref = shortRef(id);
      n.outcome = "success";
      n.donorId = id;
      if (isWalkIn) n.queueNumber = queueNumber;
      if (isWalkIn) {
        return json({ ok: true, ref, walkIn: true, queueNumber, emailStatus, ...(card ? { card } : {}) }, 200);
      }
      return json({ ok: true, ref, slotId: slot, emailStatus, ...(card ? { card } : {}) }, 200);
    };

    // A retry of a registration whose response was lost: answer with the original result, never register twice.
    const replay = async (): Promise<Response | null> => {
      if (!input.submissionId) return null;
      const prior = await findSubmission(input.submissionId);
      if (!prior || prior.cpr !== input.cpr) return null;
      if (image && !prior.hasImage) await attachCprImage(prior.id, image.bytes, image.ext);
      console.info(`signup replay donor=${prior.id}`);
      // Not sent yet usually means the first request's after() send is still running.
      const emailStatus = !prior.email ? "none" : prior.emailSent ? "sent" : "sending";
      const res = success(prior.id, prior.slotId === null, prior.slotId, prior.queueNumber, emailStatus);
      n.outcome = "replay";
      return res;
    };
    const early = await replay();
    if (early) return early;

    if (!event.public_registration_open) {
      n.outcome = "registration_closed";
      return json({ ok: false, error: "registration_closed" }, 403);
    }

    const { flagged, reasons } = computeFlags(
      { recentDonation: input.recentDonation, onMedication: input.onMedication },
      input.dob,
      event.event_date,
    );

    const slotId = walkIn ? null : (input as SignupInput).slotId;
    const result = await registerDonor({
      fullName: input.fullName,
      cpr: input.cpr,
      dob: input.dob,
      phone: input.phone,
      email: input.email,
      bloodType: input.bloodType,
      slotId,
      recentDonation: input.recentDonation,
      onMedication: input.onMedication,
      flagged,
      flagReasons: reasons,
      submissionId: input.submissionId,
    });
    if (!result.ok) {
      if (result.reason === "duplicate_cpr") {
        const late = await replay();
        if (late) return late;
      }
      n.outcome = result.reason;
      if (result.reason === "registration_closed") return json({ ok: false, error: result.reason }, 403);
      return json({ ok: false, error: result.reason }, 409);
    }

    // The photo is a convenience for staff: if the upload fails the registration still stands.
    if (image) await attachCprImage(result.id, image.bytes, image.ext);

    // The email (PDF render plus Gmail SMTP, several seconds) is sent after the response, so the
    // donor isn't kept waiting. sendDonorEmail never throws; a failed or skipped send is left for
    // the daily cron and the admin resend, as before.
    let emailStatus: EmailStatus = "none";
    if (input.email) {
      const donorId = result.id;
      after(async () => {
        await sendDonorEmail(donorId);
      });
      emailStatus = "sending";
    }

    return success(result.id, walkIn, slotId, result.queueNumber, emailStatus);
  } catch (e) {
    const message = e instanceof Error ? e.message : "unknown";
    console.error(`signup error: ${message}`);
    reportAlert({ event: "signup_error", code: "server", detail: message });
    n.outcome = "server";
    return json({ ok: false, error: "server" }, 500);
  }
}
