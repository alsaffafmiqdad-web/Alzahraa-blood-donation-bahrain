import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DonorCardData } from "@/lib/pdf/DonorCard";

const CPR = "990101123";
const data: DonorCardData = {
  fullName: "علي حسن",
  ref: "A1B2C3D4",
  bloodType: "O+",
  slotTime: "09:30:00",
  signupDate: "2026-10-03T10:00:00Z",
  event: {
    name_ar: "حملة عطاء الزهراء ال 9 للتبرع بالدم",
    name_en: "Alzahraa Ataa 9th Blood Donation Campaign",
    location_ar: "حملة التبرع بالدم للرجال، صالة فاطمة كانو، توبلي",
    location_en: "Men's blood donation drive, Fatima Kanoo Hall, Tubli",
    event_date: "2026-10-16",
  },
  org: { name: "Alzahraa Committee", email: "info@example.org", phone: "+973 1700 0000" },
};

async function pdfText(buf: Buffer): Promise<string> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), useSystemFonts: false }).promise;
  let out = "";
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    out += content.items.map((it) => ("str" in it ? it.str : "")).join(" ") + "\n";
  }
  return out;
}

afterEach(() => {
  vi.resetModules();
  vi.doUnmock("@/lib/config");
});

describe("renderDonorCard", () => {
  it("renders a bilingual PDF with an embedded Plex font and no CPR", async () => {
    const { renderDonorCard } = await import("@/lib/pdf/render");
    const buf = await renderDonorCard(data);
    expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(buf.length).toBeGreaterThan(1000);
    expect(buf.toString("latin1")).toContain("IBMPlexSansArabic");
    if (process.env.WRITE_SAMPLE_PDF === "1") {
      const out = path.resolve(__dirname, "../../.pipeline/sample-donor-card.pdf");
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, buf);
    }
    const text = await pdfText(buf);
    expect(text).toContain("Donor card");
    expect(text).toContain("A1B2C3D4");
    expect(text).toMatch(/[؀-ۿﭐ-﻿]/);
    expect(text).not.toContain(CPR);
  }, 30_000);

  it("renders English only when PDF_ARABIC_ENABLED is false", async () => {
    vi.doMock("@/lib/config", async (orig) => ({
      ...(await orig<typeof import("@/lib/config")>()),
      PDF_ARABIC_ENABLED: false,
    }));
    const { renderDonorCard } = await import("@/lib/pdf/render");
    const buf = await renderDonorCard({ ...data, fullName: "Ali Hasan" });
    const text = await pdfText(buf);
    expect(text).toContain("Donor card");
    expect(text).not.toMatch(/[؀-ۿﭐ-﻿]/);
  }, 30_000);
});
