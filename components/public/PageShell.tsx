import type { Dictionary, Locale } from "@/lib/i18n";
import { TopBar } from "@/components/public/TopBar";

/** Top bar plus a start-aligned content column. Used by the success, privacy and closed or unavailable join pages. */
export function PageShell({ locale, dict, children }: { locale: Locale; dict: Dictionary; children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <TopBar locale={locale} languageLabel={dict.common.language} brand={dict.common.appTitle} />
      <main id="main" className="mx-auto w-full max-w-xl flex-1 px-4 py-6 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        {children}
      </main>
    </div>
  );
}
