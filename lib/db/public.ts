import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export type EventRow = {
  name_ar: string;
  name_en: string;
  location_ar: string;
  location_en: string;
  event_date: string;
  event_start_time: string;
  public_registration_open: boolean;
};

export async function getEvent(): Promise<EventRow> {
  const { data, error } = await createSupabaseAdminClient()
    .from("event")
    .select("name_ar, name_en, location_ar, location_en, event_date, event_start_time, public_registration_open")
    .single();
  if (error || !data) throw new Error(`getEvent failed: ${error?.message ?? "no row"}`);
  return data as EventRow;
}

export type SlotAvailability = { id: number; startsAt: string; capacity: number; booked: number };

export async function getSlotAvailability(): Promise<SlotAvailability[]> {
  const { data, error } = await createSupabaseAdminClient().rpc("slot_availability");
  if (error) throw new Error(`slot_availability failed: ${error.message}`);
  return ((data ?? []) as { id: number; starts_at: string; capacity: number; booked: number }[]).map((r) => ({
    id: r.id,
    startsAt: r.starts_at,
    capacity: r.capacity,
    booked: r.booked,
  }));
}

export type RegisterDonorInput = {
  fullName: string;
  cpr: string;
  dob: string;
  phone: string;
  email?: string;
  bloodType: string;
  slotId: number | null;
  recentDonation: boolean;
  onMedication: boolean;
  flagged: boolean;
  flagReasons: string[];
};

export type RegisterResult =
  | { ok: true; id: string; queueNumber: number | null }
  | { ok: false; reason: "duplicate_cpr" | "slot_full" | "slot_unavailable" | "registration_closed" };

const REASONS = ["duplicate_cpr", "slot_full", "slot_unavailable", "registration_closed"] as const;

export async function registerDonor(input: RegisterDonorInput): Promise<RegisterResult> {
  const common = {
    p_full_name: input.fullName,
    p_cpr: input.cpr,
    p_dob: input.dob,
    p_phone: input.phone,
    p_email: input.email ?? "",
    p_blood_type: input.bloodType,
    p_q_recent_donation: input.recentDonation,
    p_q_on_medication: input.onMedication,
    p_flagged: input.flagged,
    p_flag_reasons: input.flagReasons,
  };
  const walkIn = input.slotId === null;
  const fn = walkIn ? "register_walk_in_donor" : "register_donor";
  const { data, error } = await createSupabaseAdminClient().rpc(
    fn,
    walkIn ? common : { ...common, p_slot_id: input.slotId as number },
  );
  if (error) {
    const reason = REASONS.find((r) => error.message.includes(r));
    if (reason) return { ok: false, reason };
    throw new Error(`${fn} failed: ${error.message}`);
  }
  if (walkIn) {
    const row = (Array.isArray(data) ? data[0] : data) as { donor_id: string; queue_number: number } | undefined;
    if (!row || typeof row.donor_id !== "string") throw new Error("register_walk_in_donor returned no id");
    return { ok: true, id: row.donor_id, queueNumber: row.queue_number };
  }
  if (typeof data !== "string") throw new Error("register_donor returned no id");
  return { ok: true, id: data, queueNumber: null };
}
