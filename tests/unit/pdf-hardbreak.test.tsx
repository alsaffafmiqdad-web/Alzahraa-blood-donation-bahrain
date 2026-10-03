import { describe, expect, it } from "vitest";
import { hardBreakLongWords, type DonorCardData } from "@/lib/pdf/DonorCard";

describe("hardBreakLongWords (last resort at the font floor)", () => {
  it("leaves normal names, Arabic and Latin, exactly as they are", () => {
    for (const n of ["Ali Hasan", "عبدالرحمن بن محمد بن عبدالله", "A", "  spaced   out  "]) {
      expect(hardBreakLongWords(n)).toBe(n);
    }
  });
  it("leaves a long but still-fitting word alone (the font shrinks instead)", () => {
    const w = "ع".repeat(90);
    expect(hardBreakLongWords(w)).toBe(w);
  });
  it("splits a word that cannot fit even at the floor, keeping every character in order", () => {
    const w = "ع".repeat(250);
    const out = hardBreakLongWords(`${w} علي`);
    const parts = out.split(" ");
    expect(parts.length).toBeGreaterThan(2);
    expect(parts.slice(0, -1).every((p) => p.length <= 97)).toBe(true);
    expect(out.replace(/ /g, "")).toBe(w + "علي");
    expect(parts.at(-1)).toBe("علي");
  });
  it("also protects a Latin one-word name", () => {
    const out = hardBreakLongWords("W".repeat(300));
    expect(out.split(" ").length).toBeGreaterThan(1);
    expect(out.replace(/ /g, "")).toBe("W".repeat(300));
  });
});

describe("donor card with a single absurdly long word", () => {
  it("still renders on one page and every character is present in the PDF text", async () => {
    const { renderDonorCard } = await import("@/lib/pdf/render");
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const data: DonorCardData = {
      fullName: "ع".repeat(400),
      ref: "A1B2C3D4",
      bloodType: "O+",
      slotTime: "09:30:00",
      signupDate: "2026-10-03T10:00:00Z",
      event: { name_ar: "حملة", name_en: "Campaign", location_ar: "توبلي", location_en: "Tubli", event_date: "2026-10-16" },
      org: { name: "Org", email: "i@example.org", phone: "+973 1700 0000" },
    };
    const doc = await pdfjs.getDocument({ data: new Uint8Array(await renderDonorCard(data)) }).promise;
    expect(doc.numPages).toBe(1);
    const page = await doc.getPage(1);
    const items = (await page.getTextContent()).items.map((it) => ("str" in it ? it.str : ""));
    const count = items.join("").split("ع").length - 1;
    expect(count).toBeGreaterThanOrEqual(400);
    // nothing is placed to the right of the page edge (A5 is 419.5 pt wide)
    for (const it of (await page.getTextContent()).items) {
      if ("transform" in it) expect(it.transform[4]).toBeLessThan(419.5);
    }
  }, 60_000);
});
