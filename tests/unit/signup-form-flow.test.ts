import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getDictionary } from "@/lib/i18n";

const src = readFileSync("components/public/SignupForm.tsx", "utf8");

// No jsdom here, so the mode-flip path is pinned at source level; the click-through is a manual check.
describe("SignupForm mode flip and submit wiring", () => {
  it("shows form_changed, stores the fields and refreshes when a walk-in page gets slotId validation", () => {
    expect(src).toMatch(/walkIn && json\.fields && "slotId" in json\.fields/);
    expect(src).toContain("dict.errors.form_changed");
    expect(src).toMatch(/form_changed[\s\S]{0,120}setErrors\(json\.fields\)[\s\S]{0,60}router\.refresh\(\)/);
  });
  it("omits slotId and an absent photo from the request in walk-in mode, and routes to the walk-in success url", () => {
    expect(src).toContain('qs.set("slot", "walk_in")');
    expect(src).toContain("json.queueNumber");
    expect(src).toMatch(/photoRequired\(walkIn\)/);
  });
  it("has form_changed copy in both languages without dashes", () => {
    for (const l of ["en", "ar"] as const) {
      const v = getDictionary(l).errors.form_changed;
      expect(v.length).toBeGreaterThan(10);
      expect(v).not.toMatch(/[\u2013\u2014]/);
    }
  });
});
