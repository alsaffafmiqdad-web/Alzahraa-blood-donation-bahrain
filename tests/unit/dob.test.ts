import { describe, expect, it } from "vitest";
import { cleanDobPart, composeDob, dobExample, dobPartsError } from "@/lib/dob";

describe("dob", () => {
  it("cleanDobPart converts Arabic digits and cuts to max", () => {
    expect(cleanDobPart("٢٠٠٨٩", 4)).toBe("2008");
    expect(cleanDobPart("1a2b3", 2)).toBe("12");
  });
  it("composeDob pads and returns empty when all empty", () => {
    expect(composeDob({ day: "5", month: "3", year: "1990" })).toBe("1990-03-05");
    expect(composeDob({ day: "", month: "", year: "" })).toBe("");
  });
  it("dobPartsError", () => {
    expect(dobPartsError({ day: "", month: "", year: "" })).toBe("dob_required");
    expect(dobPartsError({ day: "1", month: "", year: "1990" })).toBe("dob_incomplete");
    expect(dobPartsError({ day: "1", month: "1", year: "199" })).toBe("dob_incomplete");
    expect(dobPartsError({ day: "1", month: "1", year: "1990" })).toBeNull();
  });
  it("dobExample is 18 years before the event", () => {
    expect(dobExample("2026-10-16")).toEqual({ day: "16", month: "10", year: "2008" });
    expect(dobExample("2028-02-29")).toEqual({ day: "28", month: "02", year: "2010" });
  });
});
