import { execFileSync } from "node:child_process";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PrintForm, type PrintDonor, type PrintEvent } from "@/components/admin/PrintForm";

const donor: PrintDonor = {
  ref: "A1B2C3D4",
  fullName: "علي حسن",
  cpr: "990101123",
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
  name_ar: "حملة عطاء الزهراء",
  name_en: "Ataa",
  location_ar: "صالة فاطمة كانو",
  location_en: "Fatima Kanoo Hall",
  event_date: "2026-10-16",
};
const html = (d: Partial<PrintDonor> = {}, e: Partial<PrintEvent> = {}) =>
  renderToStaticMarkup(<PrintForm donor={{ ...donor, ...d }} event={{ ...event, ...e }} printedOn="4 Oct 2026" />);
const text = (s: string) => s.replace(/<[^>]+>/g, "|").replace(/\|+/g, "|");

let old = "";
try {
  old = execFileSync("git", ["show", "1c28f9f^:index.html"], { encoding: "utf8", maxBuffer: 50_000_000 });
} catch {
  old = "";
}
const oldBuild = old.slice(old.indexOf("function buildPfHTML"), old.indexOf("let currentPrintDonor"));

describe("PrintForm vs the old buildPfHTML", () => {
  it("has the old A4 structure, in the same order", () => {
    const t = text(html());
    const order = [
      "Donor Registration Form",
      "Donor ID",
      "#A1B2C3D4",
      "Pre-registered",
      "Donor details",
      "Full name",
      "CPR number",
      "Date of birth",
      "Mobile",
      "Email",
      "Blood type",
      "Registered on",
      "For staff use",
      "HAEMOGLOBIN",
      "BLOOD PRESSURE",
      "PULSE",
      "WEIGHT",
      "BAG / UNIT NO.",
      "NOTES",
      "Donor signature",
      "Staff signature",
      "Printed on 4 Oct 2026 | Donor Registry",
    ];
    let pos = -1;
    for (const s of order) {
      const i = t.indexOf(s, pos + 1);
      expect(i, `"${s}" missing or out of order`).toBeGreaterThan(pos);
      pos = i;
    }
  });

  it("every label in the old template appears in the new one (except Gender, replaced by Slot)", () => {
    if (!oldBuild) return; // git history unavailable
    const labels = [...oldBuild.matchAll(/<b[^>]*>([A-Za-z][A-Za-z /.]+?)<\/b>/g)].map((m) => m[1]!);
    expect(labels.length).toBeGreaterThanOrEqual(14);
    const out = html({ notes: "n" });
    for (const l of labels) {
      if (l === "Gender") continue;
      expect(out, `label ${l}`).toContain(l);
    }
    expect(out).toContain("Slot");
  });

  it("old section titles and fixed strings are present", () => {
    if (!oldBuild) return;
    const out = html();
    for (const s of ["Donor details", "For staff use", "Donor signature", "Staff signature", "Donor Registration Form", "Donor ID"]) {
      expect(oldBuild).toContain(s);
      expect(out).toContain(s);
    }
  });

  it("old layout metrics are kept", () => {
    const out = html();
    // header: flex, 3px crimson rule; two-column dotted grid; three-column staff grid with underlines; 45% signature blocks
    expect(out).toMatch(/border-b-\[3px\][^"]*border-crimson|border-crimson[^"]*border-b-\[3px\]/);
    expect(out).toContain("grid-cols-2");
    expect(out).toContain("border-dotted");
    expect(out).toContain("grid-cols-3");
    expect(out).toContain("w-[45%]");
    expect(out).toContain("max-w-[190mm]");
    expect(out).toContain("print-page");
    expect((out.match(/w-\[45%\]/g) ?? []).length).toBe(2);
    expect((out.match(/border-dotted/g) ?? []).length).toBe(8);
    // six underlined staff cells
    expect((out.match(/border-\[#999\]/g) ?? []).length).toBe(6);
  });

  it("shows the Arabic event name, the date and the location", () => {
    const out = html();
    expect(out).toContain(event.name_ar);
    expect(out).toContain(event.location_ar);
    expect(out).toContain("2026");
  });

  it("omits the location separator when the location is empty", () => {
    const head = html({}, { location_ar: "" }).split("Donor details")[0]!;
    expect(head).not.toContain(" | ");
    expect(html().split("Donor details")[0]).toContain(" | ");
  });

  it("shows slot, '-' for missing values and Unknown blood type", () => {
    const out = html({ phone: null, email: null, dob: null, slotTime: null, bloodType: "unknown" });
    expect(out).toContain("Unknown");
    expect((text(out).match(/\|-\|/g) ?? []).length).toBeGreaterThanOrEqual(4);
  });

  it("shows queue number and source labels when present", () => {
    const out = html({ queueNumber: 12, source: "walk_in" });
    expect(out).toContain("Queue #12");
    expect(out).toContain("Walk-in");
    expect(html({ source: "admin_added" })).toContain("Staff added");
    expect(html()).not.toContain("Queue #");
  });

  it("flag banner appears only when flagged, and joins reasons with '; '", () => {
    expect(html()).not.toContain("Flagged for medical review");
    const out = html({ flagged: true, flagReasons: ["recent_donation", "on_medication"] });
    expect(out).toContain("Flagged for medical review: ");
    expect(out).toContain("; ");
  });

  it("notes only when present, and escapes markup", () => {
    expect(html()).not.toContain("Notes:");
    const out = html({ notes: "<script>alert(1)</script>" });
    expect(out).toContain("Notes:");
    expect(out).not.toContain("<script>");
  });

  it("never prints the CPR photo", () => {
    expect(html()).not.toMatch(/<img/i);
  });
});
