"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { checkInNotice } from "@/lib/check-in-notice";
import { parseFilters, urlSafeSearch, type Status } from "@/lib/donor-filters";
import { sendDonorEmail, type EmailOutcome } from "@/lib/email/dispatch";
import { CPR_IMAGE_BUCKET, CPR_IMAGE_MIME, cprImagePath, sniffImageType } from "@/lib/cpr-image";
import { createAdmin } from "@/lib/db/admins";
import { getStatusLabels } from "@/lib/db/status-labels";
import { OG_IMAGE_MAX_BYTES, SITE_ASSETS_BUCKET, ogImagePath } from "@/lib/site-assets";
import { STATUSES } from "@/lib/config";
import { formatDateShort } from "@/lib/format";
import { en } from "@/lib/i18n/dictionaries/en";
import { checkLoginRateLimit, ipFromHeaders, recordLoginFailure } from "@/lib/rate-limit";
import { computeFlags } from "@/lib/screening";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  addAdminSchema,
  adminDonorSchema,
  createSlotSchema,
  donorIdSchema,
  editDonorSchema,
  eventSchema,
  queueStartSchema,
  loginSchema,
  passwordSchema,
  setStatusSchema,
  slotIdSchema,
  statusLabelsSchema,
  themeSchema,
  updateSlotSchema,
} from "@/lib/validation";
import type { CheckInResult, FormState, SimpleResult } from "@/app/admin/action-types";

function formToObject(fd: FormData): Record<string, FormDataEntryValue> {
  const out: Record<string, FormDataEntryValue> = {};
  for (const [k, v] of fd.entries()) if (!k.startsWith("$ACTION")) out[k] = v;
  return out;
}

/** Zod issues to English field messages. Issue messages are `errors.*` keys or plain English text. */
function issueMessages(error: z.ZodError): { error: string; fieldErrors: Record<string, string> } {
  const table = en.errors as Record<string, string>;
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_";
    if (!(key in fieldErrors)) fieldErrors[key] = table[issue.message] ?? issue.message;
  }
  const first = Object.values(fieldErrors)[0] ?? "Invalid input";
  return { error: first, fieldErrors };
}

function pgCode(e: unknown): string | undefined {
  return typeof e === "object" && e !== null && "code" in e ? String((e as { code: unknown }).code) : undefined;
}

/* ---------------- auth ---------------- */

export async function signIn(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = loginSchema.safeParse(formToObject(formData));
  if (!parsed.success) return { ok: false, error: "Invalid email or password" };
  // Failed attempts per hashed client IP; the message stays generic either way.
  const ip = ipFromHeaders(await headers());
  if (!(await checkLoginRateLimit(ip))) return { ok: false, error: "Invalid email or password" };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    await recordLoginFailure(ip);
    return { ok: false, error: "Invalid email or password" };
  }
  redirect("/admin");
}

export async function signOut(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/admin/login");
}

/* ---------------- donors ---------------- */

/**
 * The dashboard search form posts here (a Server Action is a POST), then redirects to a clean GET URL.
 * A full CPR typed into the box is reduced to its last 4 digits so it never lands in the URL or logs.
 */
export async function searchDonors(formData: FormData): Promise<void> {
  await requireAdmin();
  const raw: Record<string, string> = {};
  for (const [k, v] of formData.entries()) if (typeof v === "string" && !k.startsWith("$ACTION")) raw[k] = v;
  const f = parseFilters(raw);
  const qs = new URLSearchParams();
  if (f.q) qs.set("q", urlSafeSearch(f.q));
  if (f.status && f.status !== "all") qs.set("status", f.status);
  if (f.slot) qs.set("slot", f.slot);
  if (f.source && f.source !== "all") qs.set("source", f.source);
  if (f.sort && f.sort !== "registration") qs.set("sort", f.sort);
  if (f.flagged) qs.set("flagged", "1");
  const s = qs.toString();
  redirect(s ? `/admin?${s}` : "/admin");
}


type DonorWrite = {
  full_name: string;
  cpr: string;
  phone: string | null;
  email: string | null;
  dob: string | null;
  blood_type: string;
  slot_id: number | null;
  q_recent_donation: boolean | null;
  q_on_medication: boolean | null;
  flagged: boolean;
  flag_reasons: string[];
  notes: string | null;
};

type DonorFields = {
  fullName: string;
  cpr: string;
  phone?: string;
  email?: string;
  dob?: string;
  bloodType: string;
  slotId: number | null;
  recentDonation: boolean | null;
  onMedication: boolean | null;
  notes?: string;
};

function toRow(d: DonorFields, eventDate: string): DonorWrite {
  const flags = computeFlags(
    { recentDonation: d.recentDonation, onMedication: d.onMedication },
    d.dob ?? null,
    eventDate,
  );
  return {
    full_name: d.fullName,
    cpr: d.cpr,
    phone: d.phone ?? null,
    email: d.email ?? null,
    dob: d.dob ?? null,
    blood_type: d.bloodType,
    slot_id: d.slotId,
    q_recent_donation: d.recentDonation,
    q_on_medication: d.onMedication,
    flagged: flags.flagged,
    flag_reasons: flags.reasons,
    notes: d.notes ?? null,
  };
}

export async function addDonor(_prev: FormState, formData: FormData): Promise<FormState> {
  const { supabase, userId } = await requireAdmin();
  const parsed = adminDonorSchema.safeParse(formToObject(formData));
  if (!parsed.success) return { ok: false, ...issueMessages(parsed.error) };
  const input = parsed.data;

  const { data: event } = await supabase.from("event").select("event_date").single();
  if (!event) return { ok: false, error: "Could not read the event" };

  const row = {
    ...toRow(input, (event as { event_date: string }).event_date),
    source: input.mode === "walk_in" ? "walk_in" : "admin_added",
    created_by: userId,
    consent: true,
  };
  const { data: created, error } = await supabase.from("donors").insert(row).select("id").single();
  if (error || !created) {
    if (pgCode(error) === "23505") {
      const { data: existing } = await supabase
        .from("donors")
        .select("id, full_name")
        .eq("cpr", input.cpr)
        .maybeSingle();
      if (existing) {
        const ex = existing as { id: string; full_name: string };
        return {
          ok: false,
          error: "duplicate_cpr",
          fieldErrors: { cpr: `This CPR is already registered for ${ex.full_name}` },
          existing: { id: ex.id, name: ex.full_name },
        };
      }
      return { ok: false, error: "This CPR is already registered" };
    }
    console.error(`addDonor failed: ${error?.message ?? "no row"}`);
    return { ok: false, error: "Could not save the donor. Please try again." };
  }
  const id = (created as { id: string }).id;

  let queue: number | null = null;
  let warning = false;
  if (input.checkInNow) {
    const res = await checkInDonor(id);
    if (res.ok && !res.alreadyCheckedIn) queue = res.queueNumber;
    else warning = true;
  }
  if (input.email) await sendDonorEmail(id);

  revalidatePath("/admin");
  const qs = new URLSearchParams({ created: "1" });
  if (queue !== null) qs.set("queue", String(queue));
  if (warning) qs.set("warn", "checkin");
  redirect(`/admin/donors/${id}?${qs.toString()}`);
}

export async function editDonor(_prev: FormState, formData: FormData): Promise<FormState> {
  const { supabase } = await requireAdmin();
  const parsed = editDonorSchema.safeParse(formToObject(formData));
  if (!parsed.success) return { ok: false, ...issueMessages(parsed.error) };
  const input = parsed.data;

  const { data: current } = await supabase.from("donors").select("id, source, email").eq("id", input.id).maybeSingle();
  if (!current) return { ok: false, error: "Donor not found" };
  if ((current as { source: string }).source === "self_signup" && input.slotId === null) {
    return { ok: false, error: en.errors.slot_required, fieldErrors: { slotId: en.errors.slot_required } };
  }
  const { data: event } = await supabase.from("event").select("event_date").single();
  if (!event) return { ok: false, error: "Could not read the event" };

  // A changed address starts the email lifecycle again, so the new address gets the card through the
  // normal retry path (cron, or the Send email button) even if the old one was "sent" or hit the attempt cap.
  const oldEmail = ((current as { email: string | null }).email ?? "").toLowerCase();
  const emailChanged = oldEmail !== (input.email ?? "").toLowerCase();
  const emailReset = emailChanged
    ? { email_sent: false, email_attempts: 0, email_last_error: null, email_last_attempt_at: null }
    : {};

  const { error } = await supabase
    .from("donors")
    .update({ ...toRow(input, (event as { event_date: string }).event_date), ...emailReset })
    .eq("id", input.id);
  if (error) {
    if (pgCode(error) === "23505") {
      const { data: other } = await supabase
        .from("donors")
        .select("id, full_name, created_at")
        .eq("cpr", input.cpr)
        .maybeSingle();
      if (other) {
        const o = other as { id: string; full_name: string; created_at: string };
        return {
          ok: false,
          error: `That CPR number already belongs to ${o.full_name} (registered ${formatDateShort(o.created_at)}). Choose a different number, or edit that donor instead.`,
          existing: { id: o.id, name: o.full_name },
        };
      }
    }
    console.error(`editDonor failed: ${error.message}`);
    return { ok: false, error: "Could not save the changes. Please try again." };
  }
  revalidatePath("/admin");
  revalidatePath(`/admin/donors/${input.id}`);
  redirect(`/admin/donors/${input.id}`);
}

export async function checkInDonor(donorId: string): Promise<CheckInResult> {
  const { supabase } = await requireAdmin();
  const id = donorIdSchema.safeParse(donorId);
  if (!id.success) return { ok: false, error: "Invalid donor" };
  const { data, error } = await supabase.rpc("check_in_donor", { p_donor_id: id.data });
  if (error) {
    console.error(`check_in_donor failed donor=${id.data}: ${error.message}`);
    return { ok: false, error: error.message.includes("not_found") ? "Donor not found" : "Check-in failed" };
  }
  const row = (Array.isArray(data) ? data[0] : data) as
    | { queue_number: number | null; already_checked_in: boolean; status: Status }
    | undefined;
  if (!row) return { ok: false, error: "Check-in failed" };
  revalidatePath("/admin");
  revalidatePath(`/admin/donors/${id.data}`);
  return { ok: true, queueNumber: row.queue_number, alreadyCheckedIn: row.already_checked_in, status: row.status };
}

export async function setDonorStatus(input: { donorId: string; status: Status }): Promise<SimpleResult> {
  const { supabase } = await requireAdmin();
  const parsed = setStatusSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request" };
  const { donorId, status } = parsed.data;
  // Setting 'waiting' must always go through check_in_donor so a queue number is issued atomically.
  if (status === "waiting") {
    const res = await checkInDonor(donorId);
    if (!res.ok) return res;
    const notice = checkInNotice("This donor", res, await getStatusLabels(supabase));
    return notice.kind === "error" ? { ok: false, error: notice.text } : { ok: true };
  }
  const { data, error } = await supabase.from("donors").update({ status }).eq("id", donorId).select("id");
  if (error) {
    console.error(`setDonorStatus failed donor=${donorId}: ${error.message}`);
    return { ok: false, error: "Could not update the status" };
  }
  if (!data || data.length === 0) return { ok: false, error: "Donor not found" };
  revalidatePath("/admin");
  revalidatePath(`/admin/donors/${donorId}`);
  return { ok: true };
}

export async function verifyDonor(donorId: string): Promise<SimpleResult> {
  const { supabase } = await requireAdmin();
  const id = donorIdSchema.safeParse(donorId);
  if (!id.success) return { ok: false, error: "Invalid donor" };
  const { data, error } = await supabase
    .from("donors")
    .update({ status: "verified" })
    .eq("id", id.data)
    .eq("status", "registered")
    .select("id");
  if (error) return { ok: false, error: "Could not verify the donor" };
  if (!data || data.length === 0) return { ok: false, error: "Donor is not in the registered state" };
  revalidatePath("/admin");
  revalidatePath(`/admin/donors/${id.data}`);
  return { ok: true };
}

export async function deleteDonor(donorId: string): Promise<SimpleResult> {
  const { supabase } = await requireAdmin();
  const id = donorIdSchema.safeParse(donorId);
  if (!id.success) return { ok: false, error: "Invalid donor" };
  const { data: existing } = await supabase.from("donors").select("cpr_image_path").eq("id", id.data).maybeSingle();
  const imagePath = (existing as { cpr_image_path: string | null } | null)?.cpr_image_path ?? null;
  const { error } = await supabase.from("donors").delete().eq("id", id.data);
  if (error) {
    console.error(`deleteDonor failed donor=${id.data}: ${error.message}`);
    return { ok: false, error: "Could not delete the donor" };
  }
  // An object can exist while cpr_image_path is null (a timed-out upload), so remove every possible path.
  const paths = [...new Set([imagePath, cprImagePath(id.data, "jpg"), cprImagePath(id.data, "png"), cprImagePath(id.data, "webp")])].filter(
    (p): p is string => !!p,
  );
  const { error: removeError } = await supabase.storage.from(CPR_IMAGE_BUCKET).remove(paths);
  if (removeError) {
    console.error(`deleteDonor: cpr image remove failed donor=${id.data}: ${removeError.message}`);
  }
  revalidatePath("/admin");
  return { ok: true };
}

export async function resendEmail(donorId: string): Promise<{ ok: boolean; outcome: EmailOutcome }> {
  await requireAdmin();
  const id = donorIdSchema.safeParse(donorId);
  if (!id.success) return { ok: false, outcome: "failed" };
  const outcome = await sendDonorEmail(id.data);
  revalidatePath(`/admin/donors/${id.data}`);
  revalidatePath("/admin");
  return { ok: outcome === "sent", outcome };
}

/* ---------------- event ---------------- */

export async function updateEvent(_prev: FormState, formData: FormData): Promise<FormState> {
  const { supabase } = await requireAdmin();
  const parsed = eventSchema.safeParse(formToObject(formData));
  if (!parsed.success) return { ok: false, ...issueMessages(parsed.error) };
  const { error } = await supabase.from("event").update(parsed.data).eq("id", true);
  if (error) {
    console.error(`updateEvent failed: ${error.message}`);
    return { ok: false, error: "Could not save the event" };
  }
  revalidatePath("/admin/event");
  revalidatePath("/admin");
  return { ok: true, message: "Event saved" };
}

export async function updateQueueStart(_prev: FormState, formData: FormData): Promise<FormState> {
  const { supabase } = await requireAdmin();
  const parsed = queueStartSchema.safeParse(formToObject(formData));
  if (!parsed.success) return { ok: false, ...issueMessages(parsed.error) };
  const { error } = await supabase.from("event").update({ queue_start: parsed.data.queue_start }).eq("id", true);
  if (error) {
    console.error(`updateQueueStart failed: ${error.message}`);
    return { ok: false, error: "Could not save the queue start" };
  }
  revalidatePath("/admin/event");
  return { ok: true, message: "Queue start saved" };
}

export async function updateStatusLabels(_prev: FormState, formData: FormData): Promise<FormState> {
  const { supabase } = await requireAdmin();
  const parsed = statusLabelsSchema.safeParse(formToObject(formData));
  if (!parsed.success) return { ok: false, ...issueMessages(parsed.error) };
  const labels = parsed.data;
  const results = await Promise.all(
    STATUSES.map((s) => supabase.from("status_labels").update({ label: labels[s] }).eq("status", s)),
  );
  const failed = results.find((r) => r.error);
  if (failed?.error) {
    console.error(`updateStatusLabels failed: ${failed.error.message}`);
    return {
      ok: false,
      error: pgCode(failed.error) === "23505" ? "Each status needs a different name" : "Could not save the status names",
    };
  }
  revalidatePath("/admin", "layout");
  return { ok: true, message: "Status names saved" };
}

/* ---------------- theme, link preview image ---------------- */

function revalidateSite() {
  revalidatePath("/admin/event");
  revalidatePath("/", "layout");
}

export async function updateTheme(_prev: FormState, formData: FormData): Promise<FormState> {
  const { supabase } = await requireAdmin();
  const parsed = themeSchema.safeParse(formToObject(formData));
  if (!parsed.success) return { ok: false, ...issueMessages(parsed.error) };
  const { error } = await supabase.from("event").update(parsed.data).eq("id", true);
  if (error) {
    console.error(`updateTheme failed: ${error.message}`);
    return { ok: false, error: "Could not save the colours" };
  }
  revalidateSite();
  return { ok: true, message: "Colours saved" };
}

export async function updateOgImage(_prev: FormState, formData: FormData): Promise<FormState> {
  const { supabase } = await requireAdmin();
  const file = formData.get("og_image");
  if (typeof file === "string" || file === null || file.size === 0) {
    return { ok: false, error: "Choose a JPG or PNG image" };
  }
  if (file.size > OG_IMAGE_MAX_BYTES) return { ok: false, error: "The image must be 900 KB or smaller" };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const ext = sniffImageType(bytes);
  if (ext !== "jpg" && ext !== "png") return { ok: false, error: "Choose a JPG or PNG image" };

  const { data: current } = await supabase.from("event").select("og_image_path").eq("id", true).maybeSingle();
  const oldPath = (current as { og_image_path: string | null } | null)?.og_image_path ?? null;

  const path = ogImagePath(ext);
  const bucket = supabase.storage.from(SITE_ASSETS_BUCKET);
  const upload = await bucket.upload(path, bytes, { contentType: CPR_IMAGE_MIME[ext], upsert: false, cacheControl: "31536000" });
  if (upload.error) {
    console.error(`updateOgImage upload failed: ${upload.error.message}`);
    return { ok: false, error: "Could not save the image" };
  }
  const { error } = await supabase.from("event").update({ og_image_path: path }).eq("id", true);
  if (error) {
    console.error(`updateOgImage failed: ${error.message}`);
    await bucket.remove([path]);
    return { ok: false, error: "Could not save the image" };
  }
  if (oldPath && oldPath !== path) await bucket.remove([oldPath]).catch(() => undefined);
  revalidateSite();
  return { ok: true, message: "Link preview image saved" };
}

export async function removeOgImage(): Promise<SimpleResult> {
  const { supabase } = await requireAdmin();
  const { data: current } = await supabase.from("event").select("og_image_path").eq("id", true).maybeSingle();
  const oldPath = (current as { og_image_path: string | null } | null)?.og_image_path ?? null;
  const { error } = await supabase.from("event").update({ og_image_path: null }).eq("id", true);
  if (error) {
    console.error(`removeOgImage failed: ${error.message}`);
    return { ok: false, error: "Could not remove the image" };
  }
  if (oldPath) await supabase.storage.from(SITE_ASSETS_BUCKET).remove([oldPath]).catch(() => undefined);
  revalidateSite();
  return { ok: true };
}

/* ---------------- slots ---------------- */

export async function createSlot(_prev: FormState, formData: FormData): Promise<FormState> {
  const { supabase } = await requireAdmin();
  const parsed = createSlotSchema.safeParse(formToObject(formData));
  if (!parsed.success) return { ok: false, ...issueMessages(parsed.error) };
  const { error } = await supabase
    .from("slots")
    .insert({ starts_at: parsed.data.time, capacity: parsed.data.capacity });
  if (error) {
    if (pgCode(error) === "23505") return { ok: false, error: "A slot already exists at that time" };
    console.error(`createSlot failed: ${error.message}`);
    return { ok: false, error: "Could not add the slot" };
  }
  revalidatePath("/admin/slots");
  return { ok: true, message: "Slot added" };
}

export async function updateSlot(input: { slotId: number; capacity: number; active: boolean }): Promise<SimpleResult> {
  const { supabase } = await requireAdmin();
  const parsed = updateSlotSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: issueMessages(parsed.error).error };
  const { error } = await supabase
    .from("slots")
    .update({ capacity: parsed.data.capacity, active: parsed.data.active })
    .eq("id", parsed.data.slotId);
  if (error) return { ok: false, error: "Could not update the slot" };
  revalidatePath("/admin/slots");
  return { ok: true };
}

export async function deleteSlot(slotId: number): Promise<SimpleResult> {
  const { supabase } = await requireAdmin();
  const id = slotIdSchema.safeParse(slotId);
  if (!id.success) return { ok: false, error: "Invalid slot" };
  const { count } = await supabase.from("donors").select("id", { count: "exact", head: true }).eq("slot_id", id.data);
  if ((count ?? 0) > 0) return { ok: false, error: "Slot has bookings" };
  const { error } = await supabase.from("slots").delete().eq("id", id.data);
  if (error) {
    return { ok: false, error: pgCode(error) === "23503" ? "Slot has bookings" : "Could not delete the slot" };
  }
  revalidatePath("/admin/slots");
  return { ok: true };
}

/* ---------------- account ---------------- */

export async function changePassword(_prev: FormState, formData: FormData): Promise<FormState> {
  const { supabase } = await requireAdmin();
  const parsed = passwordSchema.safeParse(formToObject(formData));
  if (!parsed.success) return { ok: false, ...issueMessages(parsed.error) };
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) return { ok: false, error: error.message };
  return { ok: true, message: "Password updated" };
}

export async function addAdmin(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin();
  const parsed = addAdminSchema.safeParse(formToObject(formData));
  if (!parsed.success) return { ok: false, ...issueMessages(parsed.error) };
  const result = await createAdmin(parsed.data);
  if (!result.ok) {
    if (result.reason === "email_exists") {
      const msg = "An account with this email already exists.";
      return { ok: false, error: msg, fieldErrors: { email: msg } };
    }
    return { ok: false, error: "Could not add the admin. Please try again." };
  }
  revalidatePath("/admin/account");
  return {
    ok: true,
    message:
      "Admin added. Share the temporary password privately. They should change it in Settings after signing in.",
  };
}
