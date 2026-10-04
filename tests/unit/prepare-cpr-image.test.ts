import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_CPR_IMAGE_BYTES, MAX_CPR_IMAGE_SOURCE_BYTES } from "@/lib/cpr-image";
import { prepareCprImage } from "@/lib/prepare-cpr-image";
import { JPEG, PNG } from "../helpers/multipart";

type FakeCanvas = {
  width: number;
  height: number;
  getContext: ReturnType<typeof vi.fn>;
  toBlob: ReturnType<typeof vi.fn>;
};

let canvases: FakeCanvas[];
let sizes: number[];
let imageFails: boolean;
let nullContext: boolean;

function makeCanvas(queue: number[]): FakeCanvas {
  return {
    width: 0,
    height: 0,
    getContext: vi.fn(() => (nullContext ? null : { drawImage: vi.fn() })),
    toBlob: vi.fn((cb: (b: Blob) => void, type: string) =>
      cb(new Blob([new Uint8Array(queue.shift() ?? 10)], { type })),
    ),
  };
}

const bitmap = (width: number, height: number) => ({ width, height, close: vi.fn() });

class FakeImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  naturalWidth = 800;
  naturalHeight = 600;
  set src(_v: string) {
    queueMicrotask(() => (imageFails ? this.onerror?.() : this.onload?.()));
  }
}

function file(magic: number[] | Uint8Array, size: number): Blob {
  const bytes = new Uint8Array(size);
  bytes.set(magic);
  return new Blob([bytes]);
}

beforeEach(() => {
  canvases = [];
  sizes = [];
  imageFails = false;
  nullContext = false;
  vi.stubGlobal("document", {
    createElement: vi.fn(() => {
      const c = makeCanvas(sizes);
      canvases.push(c);
      return c;
    }),
  });
  vi.stubGlobal("Image", FakeImage);
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:fake");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const smallJpeg = () => file(JPEG, 1024);

describe("prepareCprImage", () => {
  it("falls back to createImageBitmap without options when the options call throws", async () => {
    const bm = bitmap(4000, 3000);
    const cib = vi.fn((_f: Blob, opts?: unknown) =>
      opts ? Promise.reject(new TypeError("bad enum")) : Promise.resolve(bm),
    );
    vi.stubGlobal("createImageBitmap", cib);
    const result = await prepareCprImage(smallJpeg());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.blob.type).toBe("image/jpeg");
    expect(cib).toHaveBeenCalledTimes(2);
    expect(cib.mock.calls[0]![1]).toEqual({ imageOrientation: "from-image" });
    expect(cib.mock.calls[1]).toHaveLength(1);
    expect(canvases[0]!.width).toBe(1600);
    expect(canvases[0]!.height).toBe(1200);
    expect(canvases[0]!.toBlob.mock.calls[0]!.slice(1)).toEqual(["image/jpeg", 0.85]);
    expect(bm.close).toHaveBeenCalled();
  });

  it("uses the <img> path when both createImageBitmap calls reject", async () => {
    vi.stubGlobal("createImageBitmap", vi.fn(() => Promise.reject(new Error("no"))));
    const f = smallJpeg();
    const result = await prepareCprImage(f);
    expect(result.ok).toBe(true);
    expect(URL.createObjectURL).toHaveBeenCalledWith(f);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:fake");
    expect(canvases[0]!.width).toBe(800);
    expect(canvases[0]!.height).toBe(600);
  });

  it("uses the <img> path when createImageBitmap is not defined", async () => {
    vi.stubGlobal("createImageBitmap", undefined);
    const result = await prepareCprImage(smallJpeg());
    expect(result.ok).toBe(true);
    expect(URL.createObjectURL).toHaveBeenCalled();
  });

  describe("every decoder fails", () => {
    beforeEach(() => {
      imageFails = true;
      vi.stubGlobal("createImageBitmap", vi.fn(() => Promise.reject(new Error("no"))));
    });

    it("passes a small JPEG through unchanged", async () => {
      const f = smallJpeg();
      const result = await prepareCprImage(f);
      expect(result).toEqual({ ok: true, blob: f });
      if (result.ok) expect(result.blob).toBe(f);
      expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:fake");
    });

    it("rejects a PNG over the limit as too large", async () => {
      const result = await prepareCprImage(file(PNG, MAX_CPR_IMAGE_BYTES + 1));
      expect(result).toEqual({ ok: false, error: "cpr_image_too_large" });
    });

    it("rejects unsniffable bytes (HEIC-like) as invalid", async () => {
      const heic = [0, 0, 0, 0x18, ...[..."ftypheic"].map((c) => c.charCodeAt(0))];
      const result = await prepareCprImage(file(heic, 1024));
      expect(result).toEqual({ ok: false, error: "cpr_image_invalid" });
    });
  });

  it("retries smaller when the first encode is too large", async () => {
    vi.stubGlobal("createImageBitmap", vi.fn(() => Promise.resolve(bitmap(4000, 3000))));
    sizes.push(MAX_CPR_IMAGE_BYTES + 1, 500_000);
    const result = await prepareCprImage(smallJpeg());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.blob.size).toBe(500_000);
    const second = canvases[1]!;
    expect(Math.max(second.width, second.height)).toBe(1200);
    expect(second.toBlob.mock.calls[0]![2]).toBe(0.7);
  });

  it("does not fall back to the original when both encodes are too large", async () => {
    vi.stubGlobal("createImageBitmap", vi.fn(() => Promise.resolve(bitmap(4000, 3000))));
    sizes.push(MAX_CPR_IMAGE_BYTES + 1, MAX_CPR_IMAGE_BYTES + 1);
    const result = await prepareCprImage(smallJpeg());
    expect(result).toEqual({ ok: false, error: "cpr_image_too_large" });
  });

  it("passes a small JPEG through when getContext returns null", async () => {
    vi.stubGlobal("createImageBitmap", vi.fn(() => Promise.resolve(bitmap(4000, 3000))));
    nullContext = true;
    const f = smallJpeg();
    const result = await prepareCprImage(f);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.blob).toBe(f);
  });

  it("rejects a source over the source limit without decoding", async () => {
    const cib = vi.fn();
    vi.stubGlobal("createImageBitmap", cib);
    const result = await prepareCprImage(new Blob([new Uint8Array(MAX_CPR_IMAGE_SOURCE_BYTES + 1)]));
    expect(result).toEqual({ ok: false, error: "cpr_image_too_large" });
    expect(cib).not.toHaveBeenCalled();
  });
});
