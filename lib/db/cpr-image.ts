import "server-only";
import { CPR_IMAGE_BUCKET, CPR_IMAGE_MIME, cprImagePath, type CprImageExt } from "@/lib/cpr-image";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * Total budget for upload + path update. The donor row is already committed, so a stalled Storage
 * call must not push the signup past the function's maxDuration (30s) and turn a saved
 * registration into an error that a retry then reports as "already registered".
 */
export const CPR_IMAGE_DEADLINE_MS = 10_000;
/** The cleanup has its own budget because the main deadline may already have fired. */
export const CPR_IMAGE_CLEANUP_DEADLINE_MS = 3_000;

/** Stores the CPR card photo and records its path. Best effort: never throws, returns false on any failure or timeout. */
export async function attachCprImage(donorId: string, bytes: Uint8Array, ext: CprImageExt): Promise<boolean> {
  try {
    const client = createSupabaseAdminClient({ deadlineMs: CPR_IMAGE_DEADLINE_MS });
    const path = cprImagePath(donorId, ext);
    const up = await client.storage
      .from(CPR_IMAGE_BUCKET)
      .upload(path, bytes, { contentType: CPR_IMAGE_MIME[ext], upsert: false });
    if (up.error) throw new Error(up.error.message);
    const { error } = await client.from("donors").update({ cpr_image_path: path }).eq("id", donorId);
    if (error) {
      await createSupabaseAdminClient({ deadlineMs: CPR_IMAGE_CLEANUP_DEADLINE_MS })
        .storage.from(CPR_IMAGE_BUCKET)
        .remove([path])
        .catch(() => undefined);
      throw new Error(error.message);
    }
    return true;
  } catch (e) {
    console.error(`cpr image error donor=${donorId}: ${e instanceof Error ? e.message : "unknown"}`);
    return false;
  }
}
