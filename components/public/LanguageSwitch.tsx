"use client";

import { Suspense } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import type { Locale } from "@/lib/i18n";

const LINK_CLS =
  "inline-flex min-h-11 items-center rounded-lg border border-line-strong px-3 text-sm font-medium hover:bg-paper-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand";

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
      className={LINK_CLS}
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
        <Link href={`/${other}/join`} lang={other} className={LINK_CLS}>
          {label}
        </Link>
      }
    >
      <Inner locale={locale} label={label} />
    </Suspense>
  );
}
