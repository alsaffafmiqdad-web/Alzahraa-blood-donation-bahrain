import { NextResponse } from "next/server";
import { reportAlert } from "@/lib/alert";
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
export const maxDuration = 30;

const ERROR_CODES = new Set(Object.keys(en.errors));

function json(body: Record<string, unknown>, status: number, headers?: Record<string, string>) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

export async function POST(req: Request) {
  try {
    const ip = clientIp(req);
    if (!(await checkSignupRateLimit(ip))) {
      reportAlert({ event: "signup_rate_limited" });
      return json({ ok: false, error: "rate_limited" }, 429, { "Retry-After": "600" });
    }

    const contentType = (req.headers.get("content-type") ?? "").toLowerCase();
    let raw: unknown;
    let image: { bytes: Uint8Array; ext: CprImageExt } | null = null;
    let imageError: string | null = null;

    if (contentType.startsWith("application/json")) {
      const text = await req.text();
      if (text.length > MAX_SIGNUP_BODY_BYTES || Buffer.byteLength(text) > MAX_SIGNUP_BODY_BYTES) {
        return json({ ok: false, error: "too_large" }, 413);
      }
      try {
        raw = JSON.parse(text);
      } catch {
        return json({ ok: false, error: "bad_json" }, 400);
      }
    } else if (contentType.startsWith("multipart/form-data")) {
      const length = Number(req.headers.get("content-length"));
      if (!req.headers.get("content-length") || !Number.isFinite(length) || length > MULTIPART_SIGNUP_MAX_BYTES) {
        return json({ ok: false, error: "too_large" }, 413);
      }
      let form: FormData;
      try {
        form = await req.formData();
      } catch {
        return json({ ok: false, error: "bad_json" }, 400);
      }
      const payload = form.get("payload");
      if (typeof payload !== "string") return json({ ok: false, error: "bad_json" }, 400);
      if (Buffer.byteLength(payload) > MAX_SIGNUP_BODY_BYTES) return json({ ok: false, error: "too_large" }, 413);
      try {
        raw = JSON.parse(payload);
      } catch {
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
      return json({ ok: false, error: "unsupported_media_type" }, 415);
    }
    const event = await getEvent();
    const walkIn = isWalkInMode(event, new Date());
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
      return json({ ok: false, error: "validation", fields }, 400);
    }
    const input = parsed.data;

    if (!(await verifyTurnstile(input.token, ip))) {
      return json({ ok: false, error: "turnstile" }, 403);
    }

    // Count the attempt only now: typos (Zod) and failed Turnstile checks never burn the quota.
    if (!(await recordSignupAttempt(ip))) {
      reportAlert({ event: "signup_rate_limited" });
      return json({ ok: false, error: "rate_limited" }, 429, { "Retry-After": "600" });
    }

    // The success response, shared by the normal path and a replay of an earlier attempt.
    const success = (
      id: string,
      isWalkIn: boolean,
      slot: number | null,
      queueNumber: number | null,
      emailStatus: "sent" | "queued" | "none",
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
      const emailStatus = !prior.email ? "none" : prior.emailSent ? "sent" : "queued";
      return success(prior.id, prior.slotId === null, prior.slotId, prior.queueNumber, emailStatus);
    };
    const early = await replay();
    if (early) return early;

    if (!event.public_registration_open) {
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
      if (result.reason === "registration_closed") return json({ ok: false, error: result.reason }, 403);
      return json({ ok: false, error: result.reason }, 409);
    }

    // The photo is a convenience for staff: if the upload fails the registration still stands.
    if (image) await attachCprImage(result.id, image.bytes, image.ext);

    let emailStatus: "sent" | "queued" | "none" = "none";
    if (input.email) {
      const outcome = await sendDonorEmail(result.id);
      emailStatus = outcome === "sent" ? "sent" : outcome === "none" ? "none" : "queued";
    }

    return success(result.id, walkIn, slotId, result.queueNumber, emailStatus);
  } catch (e) {
    const message = e instanceof Error ? e.message : "unknown";
    console.error(`signup error: ${message}`);
    reportAlert({ event: "signup_error", code: "server", detail: message });
    return json({ ok: false, error: "server" }, 500);
  }
}
