import { afterEach, describe, expect, it, vi } from "vitest";
import type { DonorCardData } from "@/lib/pdf/DonorCard";

const CPR = "990101123";
const data: DonorCardData = {
  fullName: "عبدالرحمن بن محمد بن عبدالله الخليفة المحمود العلوي الحسيني البحراني",
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

async function inspect(buf: Buffer) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
  let text = "";
  for (let i = 1; i <= doc.numPages; i++) {
    const c = await (await doc.getPage(i)).getTextContent();
    text += c.items.map((it) => ("str" in it ? it.str : "")).join(" ") + "\n";
  }
  return { pages: doc.numPages, text };
}
afterEach(() => {
  vi.resetModules();
  vi.doUnmock("@/lib/config");
});

describe("donor card PDF (extra)", () => {
  it("fits on one A5 page, even with a very long Arabic name", async () => {
    const { renderDonorCard } = await import("@/lib/pdf/render");
    const { pages } = await inspect(await renderDonorCard(data));
    expect(pages).toBe(1);
  }, 30_000);
  it("says it is not medical clearance and holds no CPR, in both modes", async () => {
    const { renderDonorCard } = await import("@/lib/pdf/render");
    const buf = await renderDonorCard({ ...data, fullName: "Ali Hasan" });
    const { text } = await inspect(buf);
    expect(text).toContain("This is not medical clearance");
    expect(text).not.toContain(CPR);
    expect(buf.toString("latin1")).not.toContain(CPR);
    vi.resetModules();
    vi.doMock("@/lib/config", async (o) => ({ ...(await o<typeof import("@/lib/config")>()), PDF_ARABIC_ENABLED: false }));
    const off = await import("@/lib/pdf/render");
    const r = await inspect(await off.renderDonorCard({ ...data, fullName: "Ali Hasan" }));
    expect(r.pages).toBe(1);
    expect(r.text).toContain("This is not medical clearance");
    expect(r.text).not.toMatch(/[؀-ۿ]/);
  }, 30_000);
  it("shows the dates and the time in Latin digits in the right order (16 October 2026)", async () => {
    const { renderDonorCard } = await import("@/lib/pdf/render");
    const { text } = await inspect(await renderDonorCard({ ...data, fullName: "Ali" }));
    expect(text).toContain("16 October 2026");
    expect(text).toContain("3 October 2026");
    expect(text).toContain("9:30 am");
    expect(text).not.toMatch(/[٠-٩]/);
  }, 30_000);
});
