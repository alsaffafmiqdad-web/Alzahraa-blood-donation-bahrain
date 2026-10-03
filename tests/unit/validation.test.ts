import { describe, expect, it } from "vitest";
import {
  adminDonorSchema,
  createSlotSchema,
  eventSchema,
  passwordSchema,
  setStatusSchema,
  signupSchema,
} from "@/lib/validation";

const good = {
  slotId: 3,
  fullName: "Ali Hasan",
  cpr: "990101123",
  dob: "1990-05-05",
  phone: "33334444",
  email: "ali@example.com",
  bloodType: "O+",
  recentDonation: false,
  onMedication: false,
  consent: true,
  token: "tok",
};

function codes(input: unknown): Record<string, string> {
  const r = signupSchema.safeParse(input);
  if (r.success) return {};
  return Object.fromEntries(r.error.issues.map((i) => [i.path.join(".") || "_", i.message]));
}

describe("signupSchema", () => {
  it("accepts a good payload", () => {
    const r = signupSchema.safeParse(good);
    expect(r.success).toBe(true);
  });
  it("accepts a payload without an email", () => {
    const { email, ...rest } = good;
    void email;
    expect(signupSchema.safeParse(rest).success).toBe(true);
  });
  it("treats an empty email as undefined", () => {
    const r = signupSchema.safeParse({ ...good, email: "" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.email).toBeUndefined();
  });
  it("rejects consent false", () => expect(codes({ ...good, consent: false }).consent).toBe("consent_required"));
  it("rejects a missing screening answer", () => {
    const { recentDonation, ...rest } = good;
    void recentDonation;
    expect(codes(rest).recentDonation).toBe("answer_required");
    const { onMedication, ...rest2 } = good;
    void onMedication;
    expect(codes(rest2).onMedication).toBe("answer_required");
  });
  it("rejects a bad phone, cpr and email", () => {
    expect(codes({ ...good, phone: "1234" }).phone).toBe("phone_invalid");
    expect(codes({ ...good, cpr: "12345678" }).cpr).toBe("cpr_invalid");
    expect(codes({ ...good, email: "nope" }).email).toBe("email_invalid");
  });
  it("accepts a pasted Bahrain country code on the phone (+973, 00973, 973) and still rejects other lengths", () => {
    for (const phone of ["+973 3333 4444", "+97333334444", "0097333334444", "973 33334444", "+973-33334444"]) {
      const r = signupSchema.safeParse({ ...good, phone });
      expect(r.success, phone).toBe(true);
      if (r.success) expect(r.data.phone).toBe("33334444");
    }
    expect(codes({ ...good, phone: "+973 3333 444" }).phone).toBe("phone_invalid");
    expect(codes({ ...good, phone: "+44 7911 123456" }).phone).toBe("phone_invalid");
  });
  it("normalises Arabic digits in cpr, phone and dob", () => {
    const r = signupSchema.safeParse({ ...good, cpr: "٩٩٠١٠١١٢٣", phone: "٣٣٣٣٤٤٤٤", dob: "١٩٩٠-٠٥-٠٥" });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.cpr).toBe("990101123");
      expect(r.data.phone).toBe("33334444");
      expect(r.data.dob).toBe("1990-05-05");
    }
  });
  it("rejects an injected blood type and slotId 0", () => {
    expect(signupSchema.safeParse({ ...good, bloodType: "<b>" }).success).toBe(false);
    expect(codes({ ...good, slotId: 0 }).slotId).toBe("slot_required");
  });
  it("rejects unknown keys (flagged, feelWell, ...)", () => {
    expect(signupSchema.safeParse({ ...good, flagged: false }).success).toBe(false);
    expect(signupSchema.safeParse({ ...good, feelWell: true }).success).toBe(false);
  });
  it("rejects a name over 150 chars and trims or collapses whitespace", () => {
    expect(codes({ ...good, fullName: "a".repeat(151) }).fullName).toBe("name_required");
    const r = signupSchema.safeParse({ ...good, fullName: "  Ali   bin\n Hasan " });
    expect(r.success && r.data.fullName).toBe("Ali bin Hasan");
  });
  it("rejects a future or impossible dob", () => {
    expect(codes({ ...good, dob: "2999-01-01" }).dob).toBe("dob_invalid");
    expect(codes({ ...good, dob: "2020-02-30" }).dob).toBe("dob_invalid");
    expect(codes({ ...good, dob: "" }).dob).toBe("dob_required");
  });
});

describe("adminDonorSchema", () => {
  const base = { fullName: "Walk In", cpr: "990101123", consent: "on", recentDonation: "", onMedication: "" };
  it("accepts a walk-in without phone, email or dob", () => {
    const r = adminDonorSchema.safeParse({ ...base, mode: "walk_in" });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.phone).toBeUndefined();
      expect(r.data.recentDonation).toBeNull();
      expect(r.data.bloodType).toBe("unknown");
    }
  });
  it("rejects pre-registration without a slot", () => {
    expect(adminDonorSchema.safeParse({ ...base, mode: "pre_registration" }).success).toBe(false);
    expect(adminDonorSchema.safeParse({ ...base, mode: "pre_registration", slotId: "" }).success).toBe(false);
  });
  it("accepts pre-registration with a slot", () => {
    const r = adminDonorSchema.safeParse({ ...base, mode: "pre_registration", slotId: "4" });
    expect(r.success && r.data.slotId).toBe(4);
  });
  it("ignores the slot for a walk-in", () => {
    const r = adminDonorSchema.safeParse({ ...base, mode: "walk_in", slotId: "4" });
    expect(r.success && r.data.slotId).toBeNull();
  });
  it("parses tri-state answers", () => {
    const r = adminDonorSchema.safeParse({ ...base, mode: "walk_in", recentDonation: "yes", onMedication: "no" });
    expect(r.success && [r.data.recentDonation, r.data.onMedication]).toEqual([true, false]);
  });
  it("requires consent", () => {
    expect(adminDonorSchema.safeParse({ ...base, consent: undefined, mode: "walk_in" }).success).toBe(false);
  });
});

describe("other schemas", () => {
  it("rejects an unknown status", () => {
    expect(setStatusSchema.safeParse({ donorId: crypto.randomUUID(), status: "bogus" }).success).toBe(false);
    expect(setStatusSchema.safeParse({ donorId: crypto.randomUUID(), status: "no_show" }).success).toBe(true);
    expect(setStatusSchema.safeParse({ donorId: "nope", status: "donated" }).success).toBe(false);
  });
  it("event schema validates the date", () => {
    const ok = {
      name_ar: "a",
      name_en: "b",
      location_ar: "",
      location_en: "",
      event_date: "2026-10-16",
      public_registration_open: "on",
    };
    expect(eventSchema.safeParse(ok).success).toBe(true);
    expect(eventSchema.safeParse({ ...ok, event_date: "16/10/2026" }).success).toBe(false);
  });
  it("slot and password schemas", () => {
    expect(createSlotSchema.safeParse({ time: "14:00", capacity: "25" }).success).toBe(true);
    expect(createSlotSchema.safeParse({ time: "25:00", capacity: 25 }).success).toBe(false);
    expect(createSlotSchema.safeParse({ time: "14:00", capacity: 501 }).success).toBe(false);
    expect(passwordSchema.safeParse({ password: "short", confirm: "short" }).success).toBe(false);
    expect(passwordSchema.safeParse({ password: "a-long-enough-pw", confirm: "different-long-pw" }).success).toBe(false);
    expect(passwordSchema.safeParse({ password: "a-long-enough-pw", confirm: "a-long-enough-pw" }).success).toBe(true);
  });
});
