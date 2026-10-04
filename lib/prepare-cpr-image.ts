import {
  CPR_IMAGE_MAX_EDGE,
  MAX_CPR_IMAGE_BYTES,
  MAX_CPR_IMAGE_SOURCE_BYTES,
  sniffImageType,
} from "@/lib/cpr-image";

/* Browser only: turns the picked file into a JPEG small enough to upload. */

export type PrepareResult =
  | { ok: true; blob: Blob }
  | { ok: false; error: "cpr_image_too_large" | "cpr_image_invalid" };

type Decoded = { source: CanvasImageSource; width: number; height: number; release: () => void };

function fromBitmap(bitmap: ImageBitmap): Decoded {
  return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() };
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image decode failed"));
    img.src = url;
  });
}

/**
 * Tries each decoder in turn, because support varies by device:
 * 1. createImageBitmap with imageOrientation "from-image" (older engines throw on this value);
 * 2. createImageBitmap with no options (modern engines apply EXIF orientation by default);
 * 3. an <img> element, which every browser can decode and orients from EXIF.
 */
async function decode(file: Blob): Promise<Decoded | null> {
  if (typeof createImageBitmap === "function") {
    try {
      return fromBitmap(await createImageBitmap(file, { imageOrientation: "from-image" }));
    } catch {}
    try {
      return fromBitmap(await createImageBitmap(file));
    } catch {}
  }
  if (typeof Image === "undefined" || typeof URL.createObjectURL !== "function") return null;
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, release: () => URL.revokeObjectURL(url) };
  } catch {
    URL.revokeObjectURL(url);
    return null;
  }
}

async function encode(img: Decoded, maxEdge: number, quality: number): Promise<Blob | null> {
  if (!img.width || !img.height) return null;
  const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(img.width * scale));
  canvas.height = Math.max(1, Math.round(img.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(img.source, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/jpeg", quality));
}

async function isAcceptedType(file: Blob): Promise<boolean> {
  try {
    return sniffImageType(new Uint8Array(await file.slice(0, 12).arrayBuffer())) !== null;
  } catch {
    return false;
  }
}

export async function prepareCprImage(file: Blob): Promise<PrepareResult> {
  if (file.size > MAX_CPR_IMAGE_SOURCE_BYTES) return { ok: false, error: "cpr_image_too_large" };

  let blob: Blob | null = null;
  const img = await decode(file);
  if (img) {
    try {
      blob = await encode(img, CPR_IMAGE_MAX_EDGE, 0.85);
      if (blob && blob.size > MAX_CPR_IMAGE_BYTES) blob = await encode(img, 1200, 0.7);
    } catch {
      blob = null;
    } finally {
      img.release();
    }
  }
  if (blob && blob.size <= MAX_CPR_IMAGE_BYTES) return { ok: true, blob };

  // Last resort when the browser can't decode or re-encode: the server sniffs the original anyway.
  if (blob) return { ok: false, error: "cpr_image_too_large" };
  if (!(await isAcceptedType(file))) return { ok: false, error: "cpr_image_invalid" };
  if (file.size > MAX_CPR_IMAGE_BYTES) return { ok: false, error: "cpr_image_too_large" };
  return { ok: true, blob: file };
}
