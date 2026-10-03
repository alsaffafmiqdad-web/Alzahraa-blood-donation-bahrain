import { describe, expect, it } from "vitest";
import { ageOn, computeFlags } from "@/lib/screening";

const EVENT = "2026-10-16";
const safe = { recentDonation: false, onMedication: false };

describe("computeFlags", () => {
  it("flags each risky answer alone with exactly one reason", () => {
    expect(computeFlags({ ...safe, recentDonation: true }, "1990-01-01", EVENT)).toEqual({
      flagged: true,
      reasons: ["recent_donation"],
    });
    expect(computeFlags({ ...safe, onMedication: true }, "1990-01-01", EVENT)).toEqual({
      flagged: true,
      reasons: ["on_medication"],
    });
  });
  it("does not flag safe answers", () => {
    expect(computeFlags(safe, "1990-01-01", EVENT)).toEqual({ flagged: false, reasons: [] });
  });
  it("does not flag null answers or a null dob", () => {
    expect(computeFlags({ recentDonation: null, onMedication: null }, null, EVENT)).toEqual({
      flagged: false,
      reasons: [],
    });
  });
  it("flags age 17 and 66 on the event date", () => {
    expect(computeFlags(safe, "2008-10-17", EVENT).reasons).toEqual(["age_out_of_range"]); // 17
    expect(computeFlags(safe, "1960-10-15", EVENT).reasons).toEqual(["age_out_of_range"]); // 66
  });
  it("does not flag exactly 18 or 65 (day before 66th birthday)", () => {
    expect(computeFlags(safe, "2008-10-16", EVENT).flagged).toBe(false); // 18 today
    expect(computeFlags(safe, "1960-10-17", EVENT).flagged).toBe(false); // 65, 66th is tomorrow
  });
  it("orders reasons: donation, medication, age", () => {
    expect(computeFlags({ recentDonation: true, onMedication: true }, "2010-01-01", EVENT).reasons).toEqual([
      "recent_donation",
      "on_medication",
      "age_out_of_range",
    ]);
  });
  it("does not ask or flag anything other than the two owner-approved questions", () => {
    const r = computeFlags({ recentDonation: false, onMedication: false }, "1990-01-01", EVENT);
    expect(Object.keys(r)).toEqual(["flagged", "reasons"]);
  });
});

describe("ageOn", () => {
  it("is birthday aware", () => {
    expect(ageOn("2000-10-16", "2026-10-16")).toBe(26);
    expect(ageOn("2000-10-17", "2026-10-16")).toBe(25);
  });
  it("handles a leap-day dob", () => {
    expect(ageOn("2000-02-29", "2026-02-28")).toBe(25);
    expect(ageOn("2000-02-29", "2026-03-01")).toBe(26);
    expect(ageOn("2008-02-29", "2026-03-01")).toBe(18);
    expect(ageOn("2008-02-29", "2026-02-28")).toBe(17);
  });
});
