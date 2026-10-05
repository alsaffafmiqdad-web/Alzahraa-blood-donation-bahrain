import { HandHeart } from "lucide-react";
import type { Locale } from "@/lib/i18n";
import { LanguageSwitch } from "@/components/public/LanguageSwitch";

/** Slim sticky top bar: brand mark, then the brand (or the progress bar passed as children), then the language switch. */
export function TopBar({
  locale,
  languageLabel,
  brand,
  children,
}: {
  locale: Locale;
  languageLabel: string;
  brand: string;
  children?: React.ReactNode;
}) {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-paper/95 pt-[env(safe-area-inset-top)] backdrop-blur">
      <div className="mx-auto flex h-14 max-w-xl items-center gap-3 px-4">
        <HandHeart className="size-6 shrink-0 text-brand" aria-hidden="true" />
        {children ? (
          <div className="min-w-0 flex-1">{children}</div>
        ) : (
          <span className="flex-1 truncate font-bold text-ink">{brand}</span>
        )}
        <LanguageSwitch locale={locale} label={languageLabel} />
      </div>
    </header>
  );
}
