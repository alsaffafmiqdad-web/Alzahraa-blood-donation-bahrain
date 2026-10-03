import { NextResponse } from "next/server";
import { verifyCardToken } from "@/lib/card-link";
import { getDonorForEmail } from "@/lib/db/email";
import { donorCardPdf } from "@/lib/pdf/donor-card-pdf";

export const runtime = "nodejs";
export const maxDuration = 30;

const MAX_BODY_BYTES = 1024;

function error(code: string, status: number) {
  return NextResponse.json({ ok: false, error: code }, { status, headers: { "Cache-Control": "no-store" } });
}

/**
 * Donor card download for the person who just registered. POST only, so the token never appears in
 * a URL or request log. The token is issued by /api/signup and is valid for 2 hours.
 */
export async function POST(req: Request) {
  try {
    if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
      return error("unsupported_media_type", 415);
    }
    const text = await req.text();
    if (Buffer.byteLength(text) > MAX_BODY_BYTES) return error("too_large", 413);
    let token: unknown;
    try {
      token = (JSON.parse(text) as { token?: unknown }).token;
    } catch {
      return error("bad_json", 400);
    }
    const donorId = verifyCardToken(token);
    if (!donorId) return error("invalid_or_expired", 403);

    const donor = await getDonorForEmail(donorId);
    if (!donor) return error("not_found", 404);

    const pdf = await donorCardPdf(donor);
    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'attachment; filename="donor-card.pdf"',
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    console.error(`card error: ${e instanceof Error ? e.message : "unknown"}`);
    return error("server", 500);
  }
}
