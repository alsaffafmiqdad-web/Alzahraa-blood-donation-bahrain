import { cn } from "@/lib/utils";
import { WhatsAppIcon } from "@/components/public/WhatsAppIcon";

/** A round WhatsApp link in the theme accent. The caller positions it. */
export function WhatsAppButton({ href, label, className }: { href: string; label: string; className?: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={label}
      className={cn(
        "inline-flex size-14 items-center justify-center rounded-full bg-brand text-white shadow-lg ring-2 ring-paper transition-colors hover:bg-brand-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
        className,
      )}
    >
      <WhatsAppIcon className="size-7" />
    </a>
  );
}
