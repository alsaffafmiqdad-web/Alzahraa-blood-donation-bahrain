import { describe, expect, it } from "vitest";
import { formatDate, formatSlot, shortRef, todayInBahrain } from "@/lib/format";

describe("format", () => {
  it("shortRef", () => expect(shortRef("abcdef12-3456-7890-abcd-ef1234567890")).toBe("ABCDEF12"));
  it("formatSlot uses Latin digits in Arabic", () => {
    expect(formatSlot("08:30:00", "ar")).toMatch(/^8:30/);
    expect(formatSlot("13:30", "en")).toMatch(/1:30/);
    expect(formatSlot("08:30", "ar")).not.toMatch(/[٠-٩]/);
  });
  it("formatDate", () => {
    expect(formatDate("2026-10-16", "en")).toBe("16 October 2026");
    expect(formatDate("2026-10-16", "ar")).not.toMatch(/[٠-٩]/);
  });
  it("todayInBahrain uses UTC+3", () => {
    expect(todayInBahrain(new Date("2026-10-15T21:30:00Z"))).toBe("2026-10-16");
  });
});
