import { describe, expect, it } from "vitest";
import { keyboardInset } from "@/lib/keyboard-inset";

describe("keyboardInset", () => {
  it("is 0 under 80px", () => {
    expect(keyboardInset(800, 800, 0)).toBe(0);
    expect(keyboardInset(800, 721, 0)).toBe(0);
  });
  it("returns the exact value above that", () => {
    expect(keyboardInset(800, 720, 0)).toBe(80);
    expect(keyboardInset(800, 500, 0)).toBe(300);
    expect(keyboardInset(800, 500, 50)).toBe(250);
  });
  it("is never negative", () => {
    expect(keyboardInset(800, 900, 0)).toBe(0);
  });
});
