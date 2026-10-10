import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DRAFT_PHOTO_MAX_BYTES,
  parseDraftPhoto,
  serializeDraftPhoto,
} from "@/lib/signup-draft";
import { MAX_AUTO_RETRIES, RETRY_DELAYS_MS, classifySubmit, retryDelay } from "@/lib/submit-retry";

const form = readFileSync("components/public/SignupForm.tsx", "utf8");

describe("retry rules", () => {
  it("backoff base timings are 1.5s then 4s with two auto retries", () => {
    expect(MAX_AUTO_RETRIES).toBe(2);
    expect([...RETRY_DELAYS_MS]).toEqual([1500, 4000]);
    expect(retryDelay(0, () => 0.5)).toBe(1500);
    expect(retryDelay(1, () => 0.5)).toBe(4000);
    expect(retryDelay(5, () => 0.5)).toBe(4000);
  });
  it("never auto-retries 4xx or duplicate_cpr", () => {
    for (const status of [400, 403, 409, 413, 422, 429]) {
      expect(classifySubmit({ status, json: { error: "duplicate_cpr" } }).kind).toBe("fatal");
    }
    expect(classifySubmit({ status: 503, json: {} }).kind).toBe("retryable");
    expect(classifySubmit({ networkError: true }).kind).toBe("retryable");
  });
  it("the form resets Turnstile before every retry and reads a fresh token per attempt", () => {
    expect(form).toMatch(/for \(let attempt = 0; attempt <= MAX_AUTO_RETRIES; attempt\+\+\)/);
    expect(form).toMatch(/turnstile\.current\?\.reset\(\);\s*setRetryInfo/);
    expect(form).toMatch(/tokenRef\.current \|\| \(await waitForToken/);
    expect(form).toMatch(/tokenRef\.current = ""/);
  });
  it("reuses one submission id across attempts", () => {
    expect(form).toMatch(/const sid = submissionId \?\? crypto\.randomUUID\(\)/);
    expect(form).toContain("submissionId: sid");
  });
});

describe("draft photo cap and quota", () => {
  const bytes = (n: number) => new Uint8Array(n).fill(7);
  it("stores a photo exactly at the cap and refuses one byte over", () => {
    expect(serializeDraftPhoto(bytes(DRAFT_PHOTO_MAX_BYTES), "image/jpeg", "2026-10-16", 1)).not.toBeNull();
    expect(serializeDraftPhoto(bytes(DRAFT_PHOTO_MAX_BYTES + 1), "image/jpeg", "2026-10-16", 1)).toBeNull();
  });
  it("round trips the stored photo bytes", () => {
    const raw = serializeDraftPhoto(bytes(10), "image/png", "2026-10-16", 1)!;
    const back = parseDraftPhoto(raw, { eventDate: "2026-10-16" });
    expect(back?.type).toBe("image/png");
    expect(Array.from(back!.bytes)).toEqual(Array.from(bytes(10)));
  });
  it("storage writes swallow errors (quota) and removals are per key", () => {
    expect(form).toMatch(/function safeSet[\s\S]*?try[\s\S]*?catch/);
    expect(form).toMatch(/function safeRemove[\s\S]*?try[\s\S]*?catch/);
  });
  it("removing the photo deletes only the photo key", () => {
    expect(form).toMatch(/if \(!cprImage\) \{\s*if \(phase === "form" && !restoringPhoto\.current\) safeRemove\(DRAFT_PHOTO_KEY\);/);
  });
  it("clears both keys on success and on start over", () => {
    const success = form.slice(form.indexOf('outcome.kind === "success"'));
    expect(success.slice(0, 900)).toMatch(/safeRemove\(DRAFT_KEY\);\s*safeRemove\(DRAFT_PHOTO_KEY\)/);
    const startOver = form.slice(form.indexOf("function startOver"));
    expect(startOver.slice(0, 200)).toMatch(/safeRemove\(DRAFT_KEY\);\s*safeRemove\(DRAFT_PHOTO_KEY\)/);
  });
});

describe("floating WhatsApp button", () => {
  it("sits in the sticky bottom bar, hidden while the keyboard is open", () => {
    const bar = form.slice(form.indexOf('className="sticky bottom-0 z-30'));
    const before = bar.slice(0, bar.indexOf("<div className=\"mx-auto flex max-w-xl"));
    expect(before).toContain("<WhatsAppButton");
    expect(before).toMatch(/whatsappUrl && !kb && \(/);
    expect(before).toContain("absolute bottom-full end-4 mb-3 z-30");
  });
  it("gives the page room for the button only when it is shown", () => {
    expect(form).toMatch(/whatsappUrl \? "pb-24" : "pb-8"/);
  });
  it("takes the URL as a prop and the label from the dictionary", () => {
    expect(form).toContain("whatsappUrl: string | null;");
    expect(form).toContain("dict.common.whatsapp_label");
  });
});

describe("length errors read the live input value", () => {
  it("CPR and phone onBlur use the event value, not the render closure", () => {
    expect(form).toContain('markLength("cpr", cprInput(e.currentTarget.value)');
    expect(form).toContain('markLength("phone", phoneInput(e.currentTarget.value)');
    expect(form).not.toContain('markLength("cpr", v.cpr');
    expect(form).not.toContain('markLength("phone", v.phone');
  });
  it("the date picker is capped at the event date, not the under-18 date", () => {
    expect(form).toContain("max={eventDate}");
    expect(form).not.toContain('max="2008-10-16"');
  });
});
