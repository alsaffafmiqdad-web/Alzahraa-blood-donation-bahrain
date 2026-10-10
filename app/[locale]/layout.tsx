import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import "../globals.css";
import { thmanyahDisplay, thmanyahSans } from "../fonts";
import { LOCALES } from "@/lib/config";
import { getSiteSettings } from "@/lib/db/public";
import { dirFor, isLocale } from "@/lib/i18n";
import { publicEnv } from "@/lib/public-env";
import { siteMetadata } from "@/lib/site-metadata";
import { DEFAULT_THEME, isUsableBackground, normalizeHex, themeCss } from "@/lib/theme";

export const dynamicParams = false;

export async function generateViewport(): Promise<Viewport> {
  const settings = await getSiteSettings();
  const bg = normalizeHex(settings.background);
  return {
    width: "device-width",
    initialScale: 1,
    viewportFit: "cover",
    interactiveWidget: "resizes-content",
    themeColor: bg && isUsableBackground(bg) ? bg : DEFAULT_THEME.background,
  };
}

export function generateStaticParams() {
  return LOCALES.map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const settings = await getSiteSettings();
  return siteMetadata(locale, publicEnv.siteUrl, settings.ogImageUrl);
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const settings = await getSiteSettings();
  return (
    <html lang={locale} dir={dirFor(locale)} className={`${thmanyahSans.variable} ${thmanyahDisplay.variable}`}>
      <head>
        <style dangerouslySetInnerHTML={{ __html: themeCss(settings) }} />
      </head>
      <body className="min-h-dvh bg-paper text-ink">{children}</body>
    </html>
  );
}
