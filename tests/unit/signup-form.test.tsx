import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/ar/join",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next/script", () => ({ default: () => null }));

import { SignupForm } from "@/components/public/SignupForm";
import { getDictionary } from "@/lib/i18n";

const slots = [
  { id: 1, startsAt: "08:30:00", capacity: 25, booked: 3 },
  { id: 2, startsAt: "09:00:00", capacity: 25, booked: 25 },
];

const render = (walkIn: boolean) =>
  renderToString(
    <SignupForm
      locale="ar"
      dict={getDictionary("ar")}
      slots={walkIn ? [] : slots}
      eventDate="2026-10-16"
      slotHint="hint"
      walkIn={walkIn}
      event={{ name: "Drive Name", dateText: "16 October 2026", timeText: "8:30 AM", location: "Hall" }}
    />,
  );
const ar = getDictionary("ar");

describe("SignupForm", () => {
  describe("slot mode", () => {
    const html = render(false);
    it("renders both screening questions and the radio groups", () => {
      expect(html).toContain("تبرعت بالدم خلال 3 أشهر؟");
      expect(html).toContain("تتناول مضادات حيوية أو أدوية؟");
      expect(html.match(/type="radio"/g)).toHaveLength(15); // 2 slots + 9 blood types + 4 screening
    });
    it("shows the full slot as disabled", () => {
      expect(html).toContain("(مكتمل)");
      expect(html).toMatch(/<input[^>]*value="2"[^>]*disabled=""|<input[^>]*disabled=""[^>]*value="2"/);
    });
    it("keeps the input constraints", () => {
      expect(html).not.toContain('max="2008-10-16"'); // under-18 is flagged, never blocked
      expect(html).toContain('maxLength="16"');
      expect(html).toContain('maxLength="13"');
      expect(html).toContain('placeholder="880000000"');
      expect(html).toContain('placeholder="3XXXXXXX"');
      expect(html).toContain('placeholder="name@example.com"');
      expect(html).toContain('autoComplete="bday-year"');
      expect(html).toContain('maxLength="4"');
      expect(html).toContain('placeholder="2008"');
      expect(html).toContain('enterKeyHint="next"');
      expect(html).not.toMatch(/<h[12][^>]*text-center/);
      expect(html).not.toMatch(/\b(ml|mr|pl|pr)-\d/);
    });
    it("starts on the intro, disabled until hydrated, with the steps hidden", () => {
      expect(html).toMatch(/<h1[^>]*font-swash[^>]*>Drive Name/);
      expect(html).toContain(ar.join.register);
      expect(html).not.toContain("الخطوة 1 من");
      expect(html).toContain('<fieldset disabled=""');
      expect(html).toContain('hidden=""');
      expect(html).toContain(ar.join.loading);
    });
    it("puts no name on text inputs (CPR must never reach a URL)", () => {
      for (const n of ["fullName", "cpr", "phone"]) expect(html).not.toContain(`name="${n}"`);
    });
    it("labels the photo as required", () => {
      expect(html).toContain(ar.join.q_photo);
      expect(html).not.toContain(ar.join.q_photo_optional);
    });
  });

  describe("walk-in mode", () => {
    const html = render(true);
    it("has no slot step and shows the notice", () => {
      expect(html).not.toContain('name="slotId"');
      expect(html).toContain(ar.join.walk_in_notice);
    });
    it("has 13 radios", () => {
      expect(html.match(/type="radio"/g)).toHaveLength(13);
    });
    it("labels the photo as optional with the skip hint", () => {
      expect(html).toContain(ar.join.q_photo_optional);
      expect(html).toContain(ar.join.cpr_image_hint_walk_in);
    });
  });

  describe("accessibility in the static markup", () => {
    const html = render(false);
    const walk = render(true);
    it("labels the text inputs and wires describedby", () => {
      expect(html).toContain('id="f-dob"');
      for (const id of ["f-fullName", "f-cpr", "f-dob-day", "f-dob-month", "f-dob-year", "f-phone", "f-email"]) {
        expect(html).toContain(`for="${id}"`);
        expect(html).toContain(`id="${id}"`);
      }
      expect(html).toContain('aria-describedby="f-dob-hint"');
      expect(html).toContain('aria-describedby="slot-hint"');
      expect(html).toContain('aria-describedby="bt-hint"');
      expect(html).toContain('aria-labelledby="step-name-title"');
    });
    it("renders an empty live region for the CPR prefill hint", () => {
      expect(html).toContain('<p id="f-dob-prefill" aria-live="polite" class="text-sm text-ink-soft"></p>');
    });
    it("marks required controls and keeps email optional", () => {
      expect(html).toContain('aria-required="true"');
      expect(html).toMatch(/<input[^>]*id="f-email"(?![^>]*aria-required)[^>]*>/);
    });
    it("has polite live regions for progress, age and slow notice", () => {
      expect(html).toContain('id="f-dob-age"');
      expect(html.match(/aria-live="polite"/g)!.length).toBeGreaterThanOrEqual(3);
      expect(html).toMatch(/<form[^>]*noValidate=""/);
    });
    it("gives each step a focusable heading target", () => {
      for (const id of ["slot", "name", "identity", "contact", "bloodType", "photo", "screening", "review"]) {
        expect(html).toContain(`id="step-${id}-title"`);
      }
      expect(html.match(/tabindex="-1"/g)!.length).toBeGreaterThanOrEqual(8);
      expect(walk).not.toContain('id="step-slot-title"');
    });
    it("announces the loading state and hides decorative progress", () => {
      expect(html).toContain('role="status"');
      expect(html).toContain('role="status"');
    });
    it("exposes the radio groups as fieldsets for screening", () => {
      expect(html).toContain('id="f-recentDonation"');
      expect(html).toContain('id="f-onMedication"');
      expect(html).toContain('id="f-bloodType"');
      expect(html).toContain('id="f-slotId"');
    });
    it("has no error summary before any error", () => {
      expect(html).not.toContain(ar.join.error_summary_title);
    });
  });
});
