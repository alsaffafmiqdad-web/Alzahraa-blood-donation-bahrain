import { describe, expect, it } from "vitest";
import { cprImagePath, sniffImageType, type CprImageExt } from "@/lib/cpr-image";

const bytes = (...b: number[]) => Uint8Array.from(b);
const ascii = (s: string) => Uint8Array.from(Buffer.from(s, "latin1"));

describe("sniffImageType", () => {
  it("detects jpg, png and webp from magic bytes", () => {
    expect(sniffImageType(bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0))).toBe("jpg");
    expect(sniffImageType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0))).toBe("png");
    expect(sniffImageType(Uint8Array.from([...ascii("RIFF"), 1, 2, 3, 4, ...ascii("WEBPVP8 ")]))).toBe("webp");
  });
  it("returns null for a PDF, random bytes, WAV and empty input", () => {
    expect(sniffImageType(ascii("%PDF-1.7 ..."))).toBeNull();
    expect(sniffImageType(bytes(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12))).toBeNull();
    expect(sniffImageType(Uint8Array.from([...ascii("RIFF"), 1, 2, 3, 4, ...ascii("WAVEfmt ")]))).toBeNull();
    expect(sniffImageType(new Uint8Array())).toBeNull();
  });
});

describe("cprImagePath", () => {
  it("matches the migration's check constraint", () => {
    const re = /^[0-9a-f-]{36}\/cpr\.(jpg|png|webp)$/;
    const id = "abcdef12-3456-4890-8bcd-ef1234567890";
    for (const ext of ["jpg", "png", "webp"] as CprImageExt[]) {
      expect(cprImagePath(id, ext)).toBe(`${id}/cpr.${ext}`);
      expect(cprImagePath(id, ext)).toMatch(re);
    }
  });
});
