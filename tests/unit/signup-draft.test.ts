import { describe, expect, it } from "vitest";
import {
  DRAFT_PHOTO_MAX_BYTES,
  DRAFT_TTL_MS,
  base64ToBytes,
  bytesToBase64,
  isEmptyDraft,
  parseDraft,
  parseDraftPhoto,
  serializeDraft,
  serializeDraftPhoto,
  type DraftValues,
} from "@/lib/signup-draft";

const values: DraftValues = {
  slotId: "3", fullName: "Ali Hasan", cpr: "990101123", dobDay: "05", dobMonth: "05", dobYear: "1990",
  phone: "33334444", email: "a@b.co", bloodType: "O+", recentDonation: "no", onMedication: "yes",
};
const base = { eventDate: "2026-10-16", step: "contact" as const, values, submissionId: "aaaaaaaa-0000-4000-8000-0000000000aa", hadPhoto: true };
const NOW = 1_000_000_000_000;

describe("draft", () => {
  it("round trips", () => {
    const d = parseDraft(serializeDraft(base, NOW), { eventDate: "2026-10-16", walkIn: false });
    expect(d).toMatchObject({ ...base, v: 1, savedAt: NOW });
  });
  it("checks the TTL only when now is given", () => {
    const raw = serializeDraft(base, NOW);
    expect(parseDraft(raw, { eventDate: "2026-10-16", walkIn: false })).not.toBeNull();
    expect(parseDraft(raw, { eventDate: "2026-10-16", walkIn: false, now: NOW + DRAFT_TTL_MS })).not.toBeNull();
    expect(parseDraft(raw, { eventDate: "2026-10-16", walkIn: false, now: NOW + DRAFT_TTL_MS + 1 })).toBeNull();
  });
  it("returns null for malformed input and other event dates", () => {
    expect(parseDraft(null, { eventDate: "x", walkIn: false })).toBeNull();
    expect(parseDraft("{nope", { eventDate: "x", walkIn: false })).toBeNull();
    expect(parseDraft(JSON.stringify({ v: 1 }), { eventDate: "x", walkIn: false })).toBeNull();
    expect(parseDraft(serializeDraft(base, NOW), { eventDate: "2026-10-17", walkIn: false })).toBeNull();
    expect(parseDraft(serializeDraft({ ...base, values: { ...values, cpr: "1".repeat(14) } }, NOW), { eventDate: "2026-10-16", walkIn: false })).toBeNull();
  });
  it("walk-in clears the slot and turns the slot step into name", () => {
    const d = parseDraft(serializeDraft({ ...base, step: "slot" }, NOW), { eventDate: "2026-10-16", walkIn: true });
    expect(d?.values.slotId).toBe("");
    expect(d?.step).toBe("name");
  });
  it("never stores consent or the token", () => {
    const raw = serializeDraft({ ...base, values: { ...values, consent: true, token: "t" } as DraftValues }, NOW);
    expect(Object.keys(JSON.parse(raw).values)).not.toContain("token");
    expect(JSON.parse(raw)).not.toHaveProperty("consent");
  });
  it("isEmptyDraft", () => {
    expect(isEmptyDraft({ ...values, slotId: "", fullName: "", cpr: "", dobDay: "", dobMonth: "", dobYear: "", phone: "", email: "", bloodType: "", recentDonation: "", onMedication: "" })).toBe(true);
    expect(isEmptyDraft(values)).toBe(false);
  });
});

describe("draft photo", () => {
  const bytes = Uint8Array.from({ length: 300 }, (_, i) => i % 256);
  it("is not stored over the cap", () => {
    expect(serializeDraftPhoto(new Uint8Array(DRAFT_PHOTO_MAX_BYTES + 1), "image/jpeg", "2026-10-16", NOW)).toBeNull();
    expect(serializeDraftPhoto(new Uint8Array(DRAFT_PHOTO_MAX_BYTES), "image/jpeg", "2026-10-16", NOW)).not.toBeNull();
  });
  it("round trips", () => {
    const raw = serializeDraftPhoto(bytes, "image/png", "2026-10-16", NOW)!;
    const out = parseDraftPhoto(raw, { eventDate: "2026-10-16", now: NOW });
    expect(out?.type).toBe("image/png");
    expect(Array.from(out!.bytes)).toEqual(Array.from(bytes));
    expect(parseDraftPhoto(raw, { eventDate: "2026-10-17" })).toBeNull();
    expect(parseDraftPhoto(raw, { eventDate: "2026-10-16", now: NOW + DRAFT_TTL_MS + 1 })).toBeNull();
  });
  it("rejects an unknown type", () => {
    expect(serializeDraftPhoto(bytes, "image/gif" as never, "2026-10-16", NOW)).toBeNull();
    const raw = JSON.stringify({ v: 1, savedAt: NOW, eventDate: "2026-10-16", type: "image/gif", b64: "AA==" });
    expect(parseDraftPhoto(raw, { eventDate: "2026-10-16" })).toBeNull();
  });
  it("base64 helpers round trip 0 to 255", () => {
    const all = Uint8Array.from({ length: 256 }, (_, i) => i);
    expect(Array.from(base64ToBytes(bytesToBase64(all)))).toEqual(Array.from(all));
  });
});
