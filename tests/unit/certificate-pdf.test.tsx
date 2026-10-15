import { describe, expect, it } from "vitest";
import { certificateNameSize } from "@/lib/pdf/certificate";

async function inspect(buf: Buffer) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), useSystemFonts: false }).promise;
  const page = await doc.getPage(1);
  let text = "";
  for (const it of (await page.getTextContent()).items) {
    if ("str" in it) text += it.str + " ";
  }
  return { pages: doc.numPages, text, width: page.view[2] ?? 0, height: page.view[3] ?? 0 };
}

describe("certificateNameSize", () => {
  it("steps down at 22, 32 and 45 characters", () => {
    expect(certificateNameSize("a".repeat(22))).toBe(30);
    expect(certificateNameSize("a".repeat(23))).toBe(24);
    expect(certificateNameSize("a".repeat(32))).toBe(24);
    expect(certificateNameSize("a".repeat(33))).toBe(20);
    expect(certificateNameSize("a".repeat(45))).toBe(20);
    expect(certificateNameSize("a".repeat(46))).toBe(16);
  });
  it("ignores surrounding whitespace", () => {
    expect(certificateNameSize(`  ${"a".repeat(22)}  `)).toBe(30);
  });
});

describe("renderCertificate", () => {
  it("renders one A4 landscape page with the name", async () => {
    const { renderCertificate } = await import("@/lib/pdf/render");
    const out = await inspect(await renderCertificate("علي حسن محمد"));
    expect(out.pages).toBe(1);
    expect(out.width).toBeCloseTo(841.89, 1);
    expect(out.height).toBeCloseTo(595.28, 1);
    for (const token of ["علي", "حسن", "محمد"]) expect(out.text).toContain(token);
  });
  it("renders a Latin name", async () => {
    const { renderCertificate } = await import("@/lib/pdf/render");
    const out = await inspect(await renderCertificate("Ali Hassan"));
    expect(out.text).toContain("Ali");
    expect(out.text).toContain("Hassan");
  });
  it("renders a 150 character single-word name without throwing", async () => {
    const { renderCertificate } = await import("@/lib/pdf/render");
    const pdf = await renderCertificate("ع".repeat(150));
    expect(pdf.length).toBeGreaterThan(1000);
    expect((await inspect(pdf)).pages).toBe(1);
  });
});
