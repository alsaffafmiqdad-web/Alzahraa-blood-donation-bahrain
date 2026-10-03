import { describe, expect, it } from "vitest";
import { isValidCpr, maskCpr, normaliseDigits } from "@/lib/cpr";

describe("cpr", () => {
  it("accepts 9 ASCII digits", () => expect(isValidCpr("990101123")).toBe(true));
  it("normalises Arabic-Indic digits", () => {
    expect(normaliseDigits("٩٩٠١٠١١٢٣")).toBe("990101123");
    expect(isValidCpr("٩٩٠١٠١١٢٣")).toBe(true);
  });
  it("normalises Extended Arabic-Indic digits", () => {
    expect(isValidCpr("۹۹۰۱۰۱۱۲۳")).toBe(true);
  });
  it("strips spaces and hyphens", () => {
    expect(isValidCpr("99010112 3")).toBe(true);
    expect(isValidCpr("9901-01123")).toBe(true);
  });
  it("rejects bad values", () => {
    expect(isValidCpr("99010112")).toBe(false);
    expect(isValidCpr("9901011234")).toBe(false);
    expect(isValidCpr("99010112a")).toBe(false);
    expect(isValidCpr("")).toBe(false);
  });
  it("masks all but the last 4", () => expect(maskCpr("990101123")).toBe("*****1123"));
});
