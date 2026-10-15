import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { shortRef } from "@/lib/format";
import { renderCertificate } from "@/lib/pdf/render";
import { donorIdSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

function error(code: string, status: number) {
  return NextResponse.json({ ok: false, error: code }, { status });
}

/** The donation certificate (A4 landscape PDF) for one donor. Rendered per request, never stored. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  let supabase;
  try {
    ({ supabase } = await requireAdmin());
  } catch {
    return error("unauthorized", 401);
  }
  const { id } = await params;
  if (!donorIdSchema.safeParse(id).success) return error("not_found", 404);

  const { data, error: dbError } = await supabase.from("donors").select("id, full_name").eq("id", id).maybeSingle();
  if (dbError) {
    console.error(`certificate error donor=${id}: ${dbError.message}`);
    return error("server", 500);
  }
  if (!data) return error("not_found", 404);

  let pdf: Buffer;
  try {
    pdf = await renderCertificate((data as { full_name: string }).full_name);
  } catch (e) {
    console.error(`certificate error donor=${id}: ${e instanceof Error ? e.message : "unknown"}`);
    return error("server", 500);
  }
  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="certificate-${shortRef(id)}.pdf"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
