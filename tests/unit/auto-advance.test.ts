import { describe, expect, it } from "vitest";
import { shouldAdvance } from "@/lib/auto-advance";

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
