import "server-only";
import { STATUSES } from "@/lib/config";
import type { Status } from "@/lib/donor-filters";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/** Caps both reads, so the Discord notice can never hold the signup response for long. */
export const SIGNUP_SUMMARY_DEADLINE_MS = 2_000;

/**
 * Read-only facts for the success notice: the new donor's status and the total number of donors.
 * Each is left out on its own error. Never throws; logs the donor id and the error message only.
 */
export async function getSignupSummary(donorId: string): Promise<{ status?: Status; total?: number }> {
  const out: { status?: Status; total?: number } = {};
  try {
    const supabase = createSupabaseAdminClient({ deadlineMs: SIGNUP_SUMMARY_DEADLINE_MS });
    const [row, count] = await Promise.all([
      supabase.from("donors").select("status").eq("id", donorId).maybeSingle(),
      supabase.from("donors").select("id", { count: "exact", head: true }),
    ]);
    if (row.error) console.error(`signup summary status error donor=${donorId}: ${row.error.message}`);
    else {
      const status = (row.data as { status?: string } | null)?.status;
      if (status && (STATUSES as readonly string[]).includes(status)) out.status = status as Status;
    }
    if (count.error) console.error(`signup summary count error donor=${donorId}: ${count.error.message}`);
    else if (typeof count.count === "number" && Number.isInteger(count.count) && count.count >= 0) {
      out.total = count.count;
    }
  } catch (e) {
    console.error(`signup summary error donor=${donorId}: ${e instanceof Error ? e.message : "unknown"}`);
  }
  return out;
}
