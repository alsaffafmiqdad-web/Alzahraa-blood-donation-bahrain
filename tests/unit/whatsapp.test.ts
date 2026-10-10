import { describe, expect, it } from "vitest";
import { normalizeWhatsAppNumber, whatsAppUrl } from "@/lib/whatsapp";

describe("normalizeWhatsAppNumber", () => {
  it.each([
    ["", ""],
    ["   ", ""],
    ["97333334444", "97333334444"],
    ["+973 3333 4444", "97333334444"],
    ["0097333334444", "97333334444"],
    ["(973) 3333-4444", "97333334444"],
    ["33334444", "97333334444"],
    ["٩٧٣٣٣٣٣٤٤٤٤", "97333334444"],
    ["+44 20 7946 0958", "442079460958"],
  ])("normalises %j to %j", (input, out) => {
    expect(normalizeWhatsAppNumber(input)).toBe(out);
  });
  it.each(["abc", "3333 444a", "1234567", "1234567890123456", "+973-ext-5", "12"])("rejects %j", (input) => {
    expect(normalizeWhatsAppNumber(input)).toBeNull();
  });
});

describe("whatsAppUrl", () => {
  it("builds a wa.me link with no query string", () => {
    expect(whatsAppUrl("97333334444")).toBe("https://wa.me/97333334444");
    expect(whatsAppUrl("+973 3333 4444")).toBe("https://wa.me/97333334444");
    expect(whatsAppUrl("97333334444")).not.toContain("?");
  });
  it("is null when empty or invalid", () => {
    expect(whatsAppUrl("")).toBeNull();
    expect(whatsAppUrl(null)).toBeNull();
    expect(whatsAppUrl(undefined)).toBeNull();
    expect(whatsAppUrl("letters")).toBeNull();
  });
});
