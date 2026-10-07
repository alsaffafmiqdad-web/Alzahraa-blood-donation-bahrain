import "server-only";
import { reportAlert } from "@/lib/alert";
import { CPR_IMAGE_BUCKET, CPR_IMAGE_MIME, cprImagePath, type CprImageExt } from "@/lib/cpr-image";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * Budget for the upload. Under load (50 signups at once with full-size photos) uploads were seen
 * to take over 10s, so this leaves room for them. The donor row is already committed, so a stalled
 * Storage call must still not push the signup past the route's maxDuration (60s) and turn a saved
 * registration into an error that a retry then reports as "already registered".
 */
export const CPR_IMAGE_DEADLINE_MS = 20_000;
/**
 * The path update gets its own budget, so an upload that finishes just before its deadline is
 * still linked to the donor instead of leaving an unlinked object in the bucket.
 */
export const CPR_IMAGE_LINK_DEADLINE_MS = 5_000;
/** The cleanup has its own budget because the main deadline may already have fired. */
export const CPR_IMAGE_CLEANUP_DEADLINE_MS = 3_000;

/** Stores the CPR card photo and records its path. Best effort: never throws, returns false on any failure or timeout. */
export async function attachCprImage(donorId: string, bytes: Uint8Array, ext: CprImageExt): Promise<boolean> {
  try {
    const path = cprImagePath(donorId, ext);
    const up = await createSupabaseAdminClient({ deadlineMs: CPR_IMAGE_DEADLINE_MS }).storage
      .from(CPR_IMAGE_BUCKET)
      .upload(path, bytes, { contentType: CPR_IMAGE_MIME[ext], upsert: false });
    if (up.error) throw new Error(up.error.message);
    const { error } = await createSupabaseAdminClient({ deadlineMs: CPR_IMAGE_LINK_DEADLINE_MS })
      .from("donors").update({ cpr_image_path: path }).eq("id", donorId);
    if (error) {
      await createSupabaseAdminClient({ deadlineMs: CPR_IMAGE_CLEANUP_DEADLINE_MS })
        .storage.from(CPR_IMAGE_BUCKET)
        .remove([path])
        .catch(() => undefined);
      throw new Error(error.message);
    }
    return true;
  } catch (e) {
    const message = e instanceof Error ? e.message : "unknown";
    console.error(`cpr image error donor=${donorId}: ${message}`);
    reportAlert({ event: "cpr_upload_failed", donorId, detail: message });
    return false;
  }
}
