import fs from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PrintForm, type PrintDonor, type PrintEvent } from "@/components/admin/PrintForm";
import { hardBreakLongWords, type RegistrationFormData } from "@/lib/pdf/RegistrationForm";

/** The donor's PDF is the admin's A4 Donor Registration Form (owner decision), so it is checked against PrintForm. */

const CPR = "990101123";
const donor: PrintDonor = {
  ref: "A1B2C3D4",
  fullName: "علي حسن",
  cpr: CPR,
  dob: "1990-05-05",
  phone: "33334444",
  email: "ali@example.com",
  bloodType: "O+",
  slotTime: "09:30:00",
  createdAt: "2026-10-03T10:00:00Z",
  source: "self_signup",
  queueNumber: null,
  flagged: false,
  flagReasons: [],
  notes: null,
};
const event: PrintEvent = {
  name_ar: "حملة عطاء الزهراء ال 9 للتبرع بالدم",
  name_en: "Alzahraa Ataa 9th Blood Donation Campaign",
  location_ar: "صالة فاطمة كانو، توبلي",
  location_en: "Fatima Kanoo Hall, Tubli",
  event_date: "2026-10-16",
};
const data = (d: Partial<PrintDonor> = {}): RegistrationFormData => ({
  donor: { ...donor, ...d },
  event,
  printedOn: "4 Oct 2026",
});

async function inspect(buf: Buffer) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), useSystemFonts: false }).promise;
  let text = "";
  const xs: number[] = [];
  let width = 0;
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    width = page.view[2] ?? 0;
    for (const it of (await page.getTextContent()).items) {
      if (!("str" in it)) continue;
      text += it.str + " ";
      xs.push(it.transform[4] as number);
    }
    text += "\n";
  }
  return { pages: doc.numPages, text, xs, width, height: (await doc.getPage(1)).view[3] };
}

async function render(d: RegistrationFormData) {
  const { renderDonorCard } = await import("@/lib/pdf/render");
  return renderDonorCard(d);
}

describe("donor PDF = A4 Donor Registration Form", () => {
  it("is one A4 page with Thmanyah embedded", async () => {
    const buf = await render(data());
    expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(buf.toString("latin1")).toMatch(/thmanyah/i);
    expect(buf.toString("latin1")).not.toContain("IBMPlex");
    if (process.env.WRITE_SAMPLE_PDF === "1") {
      const out = path.resolve(__dirname, "../../.pipeline/sample-donor-card.pdf");
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, await render(data({ flagged: true, flagReasons: ["on_medication"], queueNumber: 12, notes: "Bring ID" })));
    }
    const r = await inspect(buf);
    expect(r.pages).toBe(1);
    expect(Math.round(r.width)).toBe(595);
    expect(Math.round(r.height ?? 0)).toBe(842);
  }, 30_000);

  it("has every label and value the admin print form has, including the full CPR", async () => {
    const d = data({ flagged: true, flagReasons: ["on_medication"], queueNumber: 12, notes: "Bring ID" });
    const { text } = await inspect(await render(d));
    const html = renderToStaticMarkup(<PrintForm donor={d.donor} event={d.event} printedOn={d.printedOn} />);
    const plain = html.replace(/<[^>]+>/g, "\n").replace(/&amp;/g, "&");
    // Every Latin text run on the HTML form appears in the PDF (Arabic is laid out per word, checked below).
    const runs = plain
      .split("\n")
      .map((s) => s.trim())
      .filter((s) => s && !/[؀-ۿ]/.test(s));
    const pdfText = text.replace(/\s+/g, " ").toUpperCase();
    for (const run of runs) expect(pdfText).toContain(run.replace(/\s+/g, " ").toUpperCase());
    expect(text).toContain(CPR);
    expect(text).toContain("Queue #12");
    for (const word of ["علي", "حسن", "صالة", "توبلي", "عطاء"]) expect(text).toContain(word);
  }, 30_000);

  it("omits the flag banner, queue and notes when the admin form would", async () => {
    const { text } = await inspect(await render(data()));
    expect(text).not.toMatch(/flagged for medical review/i);
    expect(text).not.toContain("Queue #");
    expect(text).not.toContain("Notes:");
  }, 30_000);

  it("shows Latin-digit dates and the slot time", async () => {
    const { text } = await inspect(await render(data({ fullName: "Ali" })));
    expect(text).toContain("16 Oct 2026");
    expect(text).toContain("3 Oct 2026");
    expect(text).toContain("5 May 1990");
    expect(text).toContain("9:30 am");
    expect(text).not.toMatch(/[٠-٩]/);
  }, 30_000);

  it("keeps a very long Arabic name and a single huge word on the page", async () => {
    for (const fullName of ["عبدالرحمن بن محمد بن عبدالله الخليفة المحمود العلوي الحسيني البحراني", "ع".repeat(400)]) {
      const r = await inspect(await render(data({ fullName })));
      expect(r.pages).toBe(1);
      for (const x of r.xs) expect(x).toBeLessThan(r.width);
      if (fullName.length === 400) expect(r.text.split("ع").length - 1).toBeGreaterThanOrEqual(400);
    }
  }, 60_000);
});

describe("hardBreakLongWords", () => {
  it("leaves normal names alone", () => {
    for (const n of ["Ali Hasan", "علي حسن", "عبدالرحمن بن محمد"]) expect(hardBreakLongWords(n)).toBe(n);
  });
  it("splits only a word wider than the cell, keeping every character", () => {
    const out = hardBreakLongWords("W".repeat(300));
    expect(out.split(" ").length).toBeGreaterThan(1);
    expect(out.replace(/ /g, "")).toBe("W".repeat(300));
    expect(hardBreakLongWords(`${"ع".repeat(200)} علي`).endsWith(" علي")).toBe(true);
  });
});
