import { describe, expect, it } from "vitest";
import { getDictionary } from "@/lib/i18n";
import { siteMetadata } from "@/lib/site-metadata";

describe("siteMetadata", () => {
  it.each(["ar", "en"] as const)("takes %s copy from the dictionary", (locale) => {
    const dict = getDictionary(locale);
    const m = siteMetadata(locale, "https://example.org");
    expect(m.title).toBe(dict.join.title);
    expect(m.description).toBe(dict.common.metaDescription);
    expect(m.openGraph?.locale).toBe(locale === "ar" ? "ar_BH" : "en_BH");
  });
  it("sets metadataBase only for an absolute http(s) URL", () => {
    expect(String(siteMetadata("en", "https://example.org").metadataBase)).toBe("https://example.org/");
    expect("metadataBase" in siteMetadata("en", "")).toBe(false);
    expect("metadataBase" in siteMetadata("en", "not a url")).toBe(false);
  });
});
