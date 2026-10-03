import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { dailyMaintenance, ping } from "@/lib/db/maintenance";
import { emailBudgetRemaining, listRetryCandidates } from "@/lib/db/email";
import { CRON_SOFT_DEADLINE_MS } from "@/lib/config";
import { emailDailyBudget } from "@/lib/env";
import { runEmailRetry, sendDonorEmail } from "@/lib/email/dispatch";

export const runtime = "nodejs";
export const maxDuration = 300; // Vercel Hobby maximum (needs Fluid compute, the default for new projects)
export const dynamic = "force-dynamic";

function authorised(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(req: Request) {
  const startedAt = Date.now();
  if (!authorised(req)) return NextResponse.json({ ok: false }, { status: 401 });

  const steps: Record<string, boolean> = { ping: true, maintenance: true, retry: true };
  try {
    await ping();
  } catch (e) {
    steps.ping = false;
    console.error(`cron ping failed: ${e instanceof Error ? e.message : "unknown"}`);
  }
  try {
    await dailyMaintenance();
  } catch (e) {
    steps.maintenance = false;
    console.error(`cron maintenance failed: ${e instanceof Error ? e.message : "unknown"}`);
  }
  let retry: Awaited<ReturnType<typeof runEmailRetry>> | null = null;
  try {
    // Per-run cap = whatever is left in the rolling 24h budget (computed in SQL, see email_budget_remaining).
    const remaining = await emailBudgetRemaining(emailDailyBudget());
    retry = await runEmailRetry({ listCandidates: listRetryCandidates, send: sendDonorEmail }, remaining, {
      deadline: startedAt + CRON_SOFT_DEADLINE_MS,
    });
  } catch (e) {
    steps.retry = false;
    console.error(`cron retry failed: ${e instanceof Error ? e.message : "unknown"}`);
  }
  return NextResponse.json({ ok: true, steps, retry });
}
