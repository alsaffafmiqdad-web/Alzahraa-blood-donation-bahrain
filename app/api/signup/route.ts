import { NextResponse } from "next/server";
import { createCardToken } from "@/lib/card-link";
import { MAX_SIGNUP_BODY_BYTES } from "@/lib/config";
import { getEvent, registerDonor } from "@/lib/db/public";
import { sendDonorEmail } from "@/lib/email/dispatch";
import { shortRef } from "@/lib/format";
import { checkSignupRateLimit, clientIp, recordSignupAttempt } from "@/lib/rate-limit";
import { computeFlags } from "@/lib/screening";
import { verifyTurnstile } from "@/lib/turnstile";
import { signupSchema } from "@/lib/validation";
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
      return json({ ok: false, error: "rate_limited" }, 429, { "Retry-After": "600" });
    }

    if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
      return json({ ok: false, error: "unsupported_media_type" }, 415);
    }

    const text = await req.text();
    if (text.length > MAX_SIGNUP_BODY_BYTES || Buffer.byteLength(text) > MAX_SIGNUP_BODY_BYTES) {
      return json({ ok: false, error: "too_large" }, 413);
    }
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      return json({ ok: false, error: "bad_json" }, 400);
    }

    const parsed = signupSchema.safeParse(raw);
    if (!parsed.success) {
      const fields: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path.join(".") || "_";
        if (!(key in fields)) fields[key] = ERROR_CODES.has(issue.message) ? issue.message : "server";
      }
      return json({ ok: false, error: "validation", fields }, 400);
    }
    const input = parsed.data;

    if (!(await verifyTurnstile(input.token, ip))) {
      return json({ ok: false, error: "turnstile" }, 403);
    }

    // Count the attempt only now: typos (Zod) and failed Turnstile checks never burn the quota.
    if (!(await recordSignupAttempt(ip))) {
      return json({ ok: false, error: "rate_limited" }, 429, { "Retry-After": "600" });
    }

    const event = await getEvent();
    if (!event.public_registration_open) {
      return json({ ok: false, error: "registration_closed" }, 403);
    }

    const { flagged, reasons } = computeFlags(
      { recentDonation: input.recentDonation, onMedication: input.onMedication },
      input.dob,
      event.event_date,
    );

    const result = await registerDonor({
      fullName: input.fullName,
      cpr: input.cpr,
      dob: input.dob,
      phone: input.phone,
      email: input.email,
      bloodType: input.bloodType,
      slotId: input.slotId,
      recentDonation: input.recentDonation,
      onMedication: input.onMedication,
      flagged,
      flagReasons: reasons,
    });
    if (!result.ok) {
      if (result.reason === "registration_closed") return json({ ok: false, error: result.reason }, 403);
      return json({ ok: false, error: result.reason }, 409);
    }

    let emailStatus: "sent" | "queued" | "none" = "none";
    if (input.email) {
      const outcome = await sendDonorEmail(result.id);
      emailStatus = outcome === "sent" ? "sent" : outcome === "none" ? "none" : "queued";
    }

    // The card download is a convenience: if the token can't be made, the registration still succeeds.
    let card: string | undefined;
    try {
      card = createCardToken(result.id);
    } catch (e) {
      console.error(`card token error donor=${result.id}: ${e instanceof Error ? e.message : "unknown"}`);
    }

    return json({ ok: true, ref: shortRef(result.id), slotId: input.slotId, emailStatus, ...(card ? { card } : {}) }, 200);
  } catch (e) {
    console.error(`signup error: ${e instanceof Error ? e.message : "unknown"}`);
    return json({ ok: false, error: "server" }, 500);
  }
}
