import "server-only";
import { EMAIL_MAX_ATTEMPTS } from "@/lib/config";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { EventRow } from "@/lib/db/public";

export async function claimEmailSend(donorId: string, budget: number): Promise<number | null> {
  const { data, error } = await createSupabaseAdminClient().rpc("claim_email_send", {
    p_donor_id: donorId,
    p_budget: budget,
  });
  if (error) throw new Error(`claim_email_send failed: ${error.message}`);
  return typeof data === "number" ? data : data === null || data === undefined ? null : Number(data);
}

/** Emails still allowed in the rolling 24h window. The SQL function is the single source of this arithmetic. */
export async function emailBudgetRemaining(budget: number): Promise<number> {
  const { data, error } = await createSupabaseAdminClient().rpc("email_budget_remaining", { p_budget: budget });
  if (error) throw new Error(`email_budget_remaining failed: ${error.message}`);
  return Math.max(0, Number(data ?? 0));
}

export async function finishEmailSend(claimId: number, success: boolean, errorText: string | null): Promise<void> {
  const { error } = await createSupabaseAdminClient().rpc("finish_email_send", {
    p_claim_id: claimId,
    p_success: success,
    p_error: errorText,
  });
  if (error) throw new Error(`finish_email_send failed: ${error.message}`);
}

/** Donor ids with an email that is not yet sent and under the attempt cap, oldest first. */
export async function listRetryCandidates(limit: number): Promise<string[]> {
  const { data, error } = await createSupabaseAdminClient()
    .from("donors")
    .select("id")
    .not("email", "is", null)
    .eq("email_sent", false)
    .lt("email_attempts", EMAIL_MAX_ATTEMPTS)
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) throw new Error(`listRetryCandidates failed: ${error.message}`);
  return ((data ?? []) as { id: string }[]).map((r) => r.id);
}

export type DonorForEmail = {
  id: string;
  email: string | null;
  fullName: string;
  bloodType: string;
  slotTime: string | null;
  createdAt: string;
  event: EventRow;
};

export async function getDonorForEmail(donorId: string): Promise<DonorForEmail | null> {
  const db = createSupabaseAdminClient();
  const { data: donor, error } = await db
    .from("donors")
    .select("id, email, full_name, blood_type, slot_id, created_at")
    .eq("id", donorId)
    .maybeSingle();
  if (error) throw new Error(`getDonorForEmail failed: ${error.message}`);
  if (!donor) return null;
  let slotTime: string | null = null;
  if (donor.slot_id !== null) {
    const { data: slot } = await db.from("slots").select("starts_at").eq("id", donor.slot_id).maybeSingle();
    slotTime = (slot?.starts_at as string | undefined) ?? null;
  }
  const { data: event, error: evErr } = await db
    .from("event")
    .select("name_ar, name_en, location_ar, location_en, event_date, public_registration_open")
    .single();
  if (evErr || !event) throw new Error(`getDonorForEmail event failed: ${evErr?.message ?? "no row"}`);
  return {
    id: donor.id as string,
    email: (donor.email as string | null) ?? null,
    fullName: donor.full_name as string,
    bloodType: donor.blood_type as string,
    slotTime,
    createdAt: donor.created_at as string,
    event: event as EventRow,
  };
}
