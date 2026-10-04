import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Droplet } from "lucide-react";
import "../globals.css";
import { thmanyahDisplay, thmanyahSans } from "../fonts";
import { LOCALES } from "@/lib/config";
import { dirFor, getDictionary, isLocale } from "@/lib/i18n";
import { LanguageSwitch } from "@/components/public/LanguageSwitch";

export const dynamicParams = false;

export function generateStaticParams() {
  return LOCALES.map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  return { title: getDictionary(locale).join.title };
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
  const dict = getDictionary(locale);
  return (
    <html lang={locale} dir={dirFor(locale)} className={`${thmanyahSans.variable} ${thmanyahDisplay.variable}`}>
      <body className="bg-paper text-ink min-h-screen">
        <header className="border-b border-line bg-white">
          <div className="mx-auto flex max-w-xl items-center justify-between gap-3 px-4 py-3">
            <div className="flex items-center gap-2 font-bold text-crimson">
              <Droplet className="size-6 fill-crimson" aria-hidden="true" />
              <span>{dict.common.appTitle}</span>
            </div>
            <LanguageSwitch locale={locale} label={dict.common.language} />
          </div>
        </header>
        <main className="mx-auto max-w-xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
