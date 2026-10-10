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
  it.each(["ar", "en"] as const)("%s: points to the bundled default image with the dictionary alt text", (locale) => {
    const dict = getDictionary(locale);
    const m = siteMetadata(locale, "https://example.org");
    const expected = [{ url: "/og-default.jpg", alt: dict.common.ogImageAlt, width: 1200, height: 630 }];
    expect(m.openGraph?.images).toEqual(expected);
    expect(m.twitter?.images).toEqual(expected);
  });
  it("uses a custom image URL when passed, without invented dimensions", () => {
    const url = "https://cdn.example.org/storage/v1/object/public/site-assets/og/1760000000000.png";
    const m = siteMetadata("en", "https://example.org", url);
    const expected = [{ url, alt: getDictionary("en").common.ogImageAlt }];
    expect(m.openGraph?.images).toEqual(expected);
    expect(m.twitter?.images).toEqual(expected);
  });
  it("sets metadataBase only for an absolute http(s) URL", () => {
    expect(String(siteMetadata("en", "https://example.org").metadataBase)).toBe("https://example.org/");
    expect("metadataBase" in siteMetadata("en", "")).toBe(false);
    expect("metadataBase" in siteMetadata("en", "not a url")).toBe(false);
  });
});
