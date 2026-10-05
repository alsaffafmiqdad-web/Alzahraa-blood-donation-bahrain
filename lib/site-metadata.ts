import type { Metadata } from "next";
import type { Locale } from "@/lib/i18n";
import { getDictionary } from "@/lib/i18n";

function baseUrl(siteUrl: string): URL | null {
  try {
    const u = new URL(siteUrl);
    return u.protocol === "http:" || u.protocol === "https:" ? u : null;
  } catch {
    return null;
  }
}

/** Title, description and link-preview tags for the public pages. Never throws. */
export function siteMetadata(locale: Locale, siteUrl: string): Metadata {
  const dict = getDictionary(locale);
  const base = baseUrl(siteUrl);
  const title = dict.join.title;
  const description = dict.common.metaDescription;
  return {
    title,
    description,
    applicationName: dict.common.appTitle,
    ...(base ? { metadataBase: base } : {}),
    openGraph: {
      type: "website",
      siteName: dict.common.appTitle,
      title,
      description,
      locale: locale === "ar" ? "ar_BH" : "en_BH",
      alternateLocale: [locale === "ar" ? "en_BH" : "ar_BH"],
    },
    twitter: { card: "summary_large_image", title, description },
  };
}
