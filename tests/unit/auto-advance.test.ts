import { describe, expect, it } from "vitest";
import { shouldAdvance, typingCountryCode } from "@/lib/auto-advance";

describe("shouldAdvance", () => {
  it("advances at exactly max", () => {
    expect(shouldAdvance("12", "1", 2, true)).toBe(true);
  });
  it("does not advance below max", () => {
    expect(shouldAdvance("1", "", 2, true)).toBe(false);
  });
  it("does not advance when the caret is not at the end", () => {
    expect(shouldAdvance("12", "13", 2, false)).toBe(false);
  });
  it("does not advance when the value did not change", () => {
    expect(shouldAdvance("12", "12", 2, true)).toBe(false);
  });
});

describe("typingCountryCode", () => {
  it("spots +973, 00973 and 973 prefixes", () => {
    expect(typingCountryCode("+973 3344")).toBe(true);
    expect(typingCountryCode("00973 334")).toBe(true);
    expect(typingCountryCode("97333445")).toBe(true);
    expect(typingCountryCode("+٩٧٣ ٣٣٤٤")).toBe(true);
  });
  it("ignores a plain local number", () => {
    expect(typingCountryCode("33445566")).toBe(false);
    expect(typingCountryCode("3344 5566")).toBe(false);
    expect(typingCountryCode("")).toBe(false);
  });
  it("lets focus move once the full number is past the code", () => {
    expect(typingCountryCode("+973 33445566")).toBe(false);
    expect(typingCountryCode("0097333445566")).toBe(false);
  });
});
