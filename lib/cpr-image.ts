import { MAX_SIGNUP_BODY_BYTES } from "@/lib/config";

/* Isomorphic: no server imports. */

export const CPR_IMAGE_BUCKET = "cpr-images";
/** After client compression; matches the bucket limit. */
export const MAX_CPR_IMAGE_BYTES = 2_000_000;
/** Raw file the browser will try to decode. */
export const MAX_CPR_IMAGE_SOURCE_BYTES = 25_000_000;
/** Longest side in px after resize. */
export const CPR_IMAGE_MAX_EDGE = 1600;
export const MULTIPART_SIGNUP_MAX_BYTES = MAX_SIGNUP_BODY_BYTES + MAX_CPR_IMAGE_BYTES + 20_000;

export type CprImageExt = "jpg" | "png" | "webp";

export const CPR_IMAGE_MIME: Record<CprImageExt, string> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

/** Detects the real type from magic bytes. The declared type and file name are never trusted. */
export function sniffImageType(bytes: Uint8Array): CprImageExt | null {
  const at = (i: number) => bytes[i];
  if (bytes.length >= 3 && at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return "jpg";
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length >= 8 && png.every((b, i) => at(i) === b)) return "png";
  const ascii = (start: number, s: string) => [...s].every((c, i) => at(start + i) === c.charCodeAt(0));
  if (bytes.length >= 12 && ascii(0, "RIFF") && ascii(8, "WEBP")) return "webp";
  return null;
}

export function cprImagePath(donorId: string, ext: CprImageExt): string {
  return `${donorId}/cpr.${ext}`;
}
