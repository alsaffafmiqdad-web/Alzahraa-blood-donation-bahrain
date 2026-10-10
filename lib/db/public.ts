import "server-only";
import { cache } from "react";
import { SITE_ASSETS_BUCKET } from "@/lib/site-assets";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { DEFAULT_THEME } from "@/lib/theme";

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

export type SiteSettings = { accent: string; background: string; ogImageUrl: string | null; whatsappNumber: string };

const DEFAULT_SETTINGS: SiteSettings = { ...DEFAULT_THEME, ogImageUrl: null, whatsappNumber: "" };

/** Theme colours, link preview image and WhatsApp number from the event row. Cached per request. Never throws. */
export const getSiteSettings: () => Promise<SiteSettings> = cache(async () => {
  try {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase
      .from("event")
      .select("theme_accent, theme_background, og_image_path, whatsapp_number")
      .single();
    if (error || !data) {
      console.error(`site settings load failed: ${error?.message ?? "no row"}`);
      return DEFAULT_SETTINGS;
    }
    const r = data as {
      theme_accent: string;
      theme_background: string;
      og_image_path: string | null;
      whatsapp_number: string;
    };
    return {
      accent: r.theme_accent,
      background: r.theme_background,
      ogImageUrl: r.og_image_path
        ? supabase.storage.from(SITE_ASSETS_BUCKET).getPublicUrl(r.og_image_path).data.publicUrl
        : null,
      whatsappNumber: r.whatsapp_number ?? "",
    };
  } catch (e) {
    console.error(`site settings load failed: ${e instanceof Error ? e.message : "unknown"}`);
    return DEFAULT_SETTINGS;
  }
});

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
  /** Idempotency key of one registration (all attempts of it share the id). */
  submissionId?: string;
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
    p_submission_id: input.submissionId ?? null,
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

export type PriorSubmission = {
  id: string;
  cpr: string;
  slotId: number | null;
  queueNumber: number | null;
  email: string | null;
  emailSent: boolean;
  hasImage: boolean;
};

/** Filters on submission_id only, never CPR (no PII in the PostgREST URL). */
export async function findSubmission(submissionId: string): Promise<PriorSubmission | null> {
  const { data, error } = await createSupabaseAdminClient()
    .from("donors")
    .select("id, cpr, slot_id, queue_number, email, email_sent, cpr_image_path")
    .eq("submission_id", submissionId)
    .maybeSingle();
  if (error) throw new Error(`findSubmission failed: ${error.message}`);
  if (!data) return null;
  const r = data as {
    id: string;
    cpr: string;
    slot_id: number | null;
    queue_number: number | null;
    email: string | null;
    email_sent: boolean | null;
    cpr_image_path: string | null;
  };
  return {
    id: r.id,
    cpr: r.cpr,
    slotId: r.slot_id,
    queueNumber: r.queue_number,
    email: r.email,
    emailSent: !!r.email_sent,
    hasImage: !!r.cpr_image_path,
  };
}
