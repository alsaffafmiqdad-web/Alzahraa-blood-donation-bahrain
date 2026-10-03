"use client";

import { Suspense } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import type { Locale } from "@/lib/i18n";

function Inner({ locale, label }: { locale: Locale; label: string }) {
  const pathname = usePathname();
  const search = useSearchParams();
  const other: Locale = locale === "ar" ? "en" : "ar";
  const rest = pathname.replace(/^\/(ar|en)(?=\/|$)/, "");
  const qs = search.toString();
  const href = `/${other}${rest}${qs ? `?${qs}` : ""}`;
  return (
    <Link
      href={href}
      hrefLang={other}
      lang={other}
      className="rounded-md border border-line px-3 py-1 text-sm font-medium text-ink hover:bg-paper-2"
    >
      {label}
    </Link>
  );
}

export function LanguageSwitch({ locale, label }: { locale: Locale; label: string }) {
  const other: Locale = locale === "ar" ? "en" : "ar";
  return (
    <Suspense
      fallback={
        <Link href={`/${other}/join`} lang={other} className="rounded-md border border-line px-3 py-1 text-sm">
          {label}
        </Link>
      }
    >
      <Inner locale={locale} label={label} />
    </Suspense>
  );
}
