import { z } from "zod";
import { reportAlert } from "@/lib/alert";
import { CLIENT_ERROR_CODES } from "@/lib/alert-format";
import { LOCALES } from "@/lib/config";
import { STEP_IDS } from "@/lib/signup-steps";

export const runtime = "nodejs";

const MAX_BODY = 1024;

const reportSchema = z.strictObject({
  code: z.enum(CLIENT_ERROR_CODES),
  step: z.enum([...STEP_IDS, "intro"]).optional(),
  status: z.number().int().min(0).max(599).optional(),
  attempt: z.number().int().min(0).max(10).optional(),
  locale: z.enum(LOCALES).optional(),
});

function reply(status: number): Response {
  return new Response(null, { status, headers: { "Cache-Control": "no-store" } });
}

/** Receives a failure code from the join form. Carries no personal data; the raw body is never logged. */
export async function POST(req: Request) {
  const origin = req.headers.get("origin");
  if (origin) {
    let host = "";
    try {
      host = new URL(origin).host;
    } catch {
      // A malformed Origin is treated as foreign.
    }
    if (host !== new URL(req.url).host) return reply(403);
  }
  if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) return reply(415);
  const text = await req.text();
  if (text.length > MAX_BODY) return reply(413);
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return reply(400);
  }
  const parsed = reportSchema.safeParse(raw);
  if (!parsed.success) return reply(400);
  const r = parsed.data;
  reportAlert({
    event: "client_error",
    code: r.code,
    detail: `step=${r.step ?? "-"} status=${r.status ?? "-"} attempt=${r.attempt ?? "-"} locale=${r.locale ?? "-"}`,
  });
  return reply(204);
}
