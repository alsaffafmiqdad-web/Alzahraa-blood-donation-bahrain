import { Camera, IdCard } from "lucide-react";
import { cn } from "@/lib/utils";

/** An ID card with a small camera badge: tells donors to upload the card itself, not a selfie. */
export function CprCardIcon({ className }: { className?: string }) {
  return (
    <span className={cn("relative inline-flex", className)} aria-hidden="true">
      <IdCard className="size-10 text-brand" />
      <span className="absolute -bottom-1 -end-1 inline-flex size-6 items-center justify-center rounded-full bg-brand ring-2 ring-white">
        <Camera className="size-4 text-white" />
      </span>
    </span>
  );
}
