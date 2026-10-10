import type { Dictionary, Locale } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { TopBar } from "@/components/public/TopBar";
import { WhatsAppButton } from "@/components/public/WhatsAppButton";

/** Top bar plus a start-aligned content column. Used by the success, privacy and closed or unavailable join pages. */
export function PageShell({
  locale,
  dict,
  children,
  whatsappUrl,
}: {
  locale: Locale;
  dict: Dictionary;
  children: React.ReactNode;
  whatsappUrl?: string | null;
}) {
  return (
    <div className="flex min-h-dvh flex-col">
      <TopBar locale={locale} languageLabel={dict.common.language} brand={dict.common.appTitle} />
      <main
        id="main"
        className={cn(
          "mx-auto w-full max-w-xl flex-1 px-4 py-6",
          whatsappUrl ? "pb-[calc(5.5rem+env(safe-area-inset-bottom))]" : "pb-[max(1.5rem,env(safe-area-inset-bottom))]",
        )}
      >
        {children}
      </main>
      {whatsappUrl && (
        <WhatsAppButton
          href={whatsappUrl}
          label={dict.common.whatsapp_label}
          className="fixed end-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-30"
        />
      )}
    </div>
  );
}
