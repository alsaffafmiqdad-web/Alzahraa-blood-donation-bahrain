import { describe, expect, it } from "vitest";
import { applyCprPrefill, autoFromRestored, dobPrefillFromCpr } from "@/lib/dob-prefill";

const TODAY = "2026-10-07";
const none = { month: false, year: false };
const both = { month: true, year: true };

describe("dobPrefillFromCpr", () => {
  it("reads year and month from the first four digits", () => {
    expect(dobPrefillFromCpr("941012345", TODAY)).toEqual({ year: "1994", month: "10" });
    expect(dobPrefillFromCpr("0001", TODAY)).toEqual({ year: "2000", month: "01" });
    expect(dobPrefillFromCpr("2612", TODAY)).toEqual({ year: "2026", month: "12" });
    expect(dobPrefillFromCpr("2701", TODAY)).toEqual({ year: "1927", month: "01" });
    expect(dobPrefillFromCpr("9901", TODAY)).toEqual({ year: "1999", month: "01" });
  });
  it("returns null for an invalid month or too few digits", () => {
    expect(dobPrefillFromCpr("9900", TODAY)).toBeNull();
    expect(dobPrefillFromCpr("9413", TODAY)).toBeNull();
    expect(dobPrefillFromCpr("941", TODAY)).toBeNull();
    expect(dobPrefillFromCpr("", TODAY)).toBeNull();
  });
  it("accepts Arabic-Indic and Extended digits", () => {
    expect(dobPrefillFromCpr("٩٤١٠", TODAY)).toEqual({ year: "1994", month: "10" });
    expect(dobPrefillFromCpr("۹۴۱۰", TODAY)).toEqual({ year: "1994", month: "10" });
  });
  it("follows today's year", () => {
    expect(dobPrefillFromCpr("2901", "2030-01-01")).toEqual({ year: "2029", month: "01" });
  });
});

describe("applyCprPrefill", () => {
  it("fills empty fields", () => {
    expect(applyCprPrefill({ dobMonth: "", dobYear: "" }, none, "9410", TODAY)).toEqual({ dobMonth: "10", dobYear: "1994", auto: both });
  });
  it("re-prefills auto fields when the CPR changes", () => {
    expect(applyCprPrefill({ dobMonth: "10", dobYear: "1994" }, both, "9503", TODAY)).toEqual({ dobMonth: "03", dobYear: "1995", auto: both });
  });
  it("does not overwrite a typed value", () => {
    const r = applyCprPrefill({ dobMonth: "05", dobYear: "1994" }, { month: false, year: true }, "9503", TODAY);
    expect(r).toEqual({ dobMonth: "05", dobYear: "1995", auto: { month: false, year: true } });
  });
  it("clears only the auto fields when the CPR drops below 4 digits or the month is invalid", () => {
    const fields = { dobMonth: "05", dobYear: "1994" };
    expect(applyCprPrefill(fields, { month: false, year: true }, "941", TODAY)).toEqual({ dobMonth: "05", dobYear: "", auto: none });
    expect(applyCprPrefill({ dobMonth: "10", dobYear: "1994" }, both, "9413", TODAY)).toEqual({ dobMonth: "", dobYear: "", auto: none });
  });
  it("fills an empty field that is not auto", () => {
    const r = applyCprPrefill({ dobMonth: "", dobYear: "1990" }, none, "9410", TODAY);
    expect(r).toEqual({ dobMonth: "10", dobYear: "1990", auto: { month: true, year: false } });
  });
});

describe("autoFromRestored", () => {
  it("is true only for a non-empty value equal to the CPR's", () => {
    expect(autoFromRestored({ dobMonth: "10", dobYear: "1994" }, "941012345", TODAY)).toEqual(both);
    expect(autoFromRestored({ dobMonth: "10", dobYear: "1990" }, "941012345", TODAY)).toEqual({ month: true, year: false });
    expect(autoFromRestored({ dobMonth: "", dobYear: "" }, "941012345", TODAY)).toEqual(none);
    expect(autoFromRestored({ dobMonth: "10", dobYear: "1994" }, "94", TODAY)).toEqual(none);
  });
});

describe("century boundaries in 2026", () => {
  it("00 to 26 give 20xx and 27 to 99 give 19xx", () => {
    for (let n = 0; n <= 99; n++) {
      const yy = String(n).padStart(2, "0");
      const r = dobPrefillFromCpr(`${yy}06`, TODAY);
      expect(r?.year).toBe(n <= 26 ? `20${yy}` : `19${yy}`);
    }
  });
  it("rejects months 00 and 13 to 99 and partial input, accepts 01 to 12", () => {
    for (let m = 0; m <= 99; m++) {
      const mm = String(m).padStart(2, "0");
      expect(dobPrefillFromCpr(`90${mm}`, TODAY) === null).toBe(m < 1 || m > 12);
    }
    expect(dobPrefillFromCpr("90", TODAY)).toBeNull();
    expect(dobPrefillFromCpr("901", TODAY)).toBeNull();
  });
  it("handles mixed Arabic-Indic and ASCII digits", () => {
    expect(dobPrefillFromCpr("٩0١2", TODAY)).toEqual({ year: "1990", month: "12" });
  });
  it("a hand-typed year survives a later CPR edit, and a restored typed year is not auto", () => {
    const typed = applyCprPrefill({ dobMonth: "10", dobYear: "1980" }, { month: true, year: false }, "9511", TODAY);
    expect(typed).toMatchObject({ dobMonth: "11", dobYear: "1980", auto: { month: true, year: false } });
    expect(autoFromRestored({ dobMonth: "10", dobYear: "1980" }, "941012345", TODAY).year).toBe(false);
  });
});
