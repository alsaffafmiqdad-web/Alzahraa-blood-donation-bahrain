import { notFound } from "next/navigation";
import { getEvent, getSlotAvailability, type EventRow, type SlotAvailability } from "@/lib/db/public";
import { isWalkInMode } from "@/lib/event-mode";
import { formatDate } from "@/lib/format";
import { getDictionary, isLocale, t } from "@/lib/i18n";
import { SignupForm } from "@/components/public/SignupForm";

export const dynamic = "force-dynamic";

function Card({ children }: { children: React.ReactNode }) {
  return <div className="rounded-xl border border-line bg-white p-5 text-center text-ink">{children}</div>;
}

export default async function JoinPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const dict = getDictionary(locale);

  let event: EventRow;
  let slots: SlotAvailability[];
  try {
    [event, slots] = await Promise.all([getEvent(), getSlotAvailability()]);
  } catch (e) {
    console.error(`join page load failed: ${e instanceof Error ? e.message : "unknown"}`);
    return <Card>{dict.join.unavailable}</Card>;
  }

  const name = locale === "ar" ? event.name_ar : event.name_en;
  const location = locale === "ar" ? event.location_ar : event.location_en;
  const date = formatDate(event.event_date, locale);
  const walkIn = isWalkInMode(event, new Date());

  return (
    <div className="space-y-5">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-crimson">{dict.join.title}</h1>
        <p className="mt-2 text-lg font-medium">{name}</p>
        <p className="text-sm text-ink-soft">
          {date}
          {location ? ` | ${location}` : ""}
        </p>
      </div>
      {event.public_registration_open ? (
        <SignupForm
          locale={locale}
          dict={dict}
          slots={walkIn ? [] : slots}
          walkIn={walkIn}
          eventDate={event.event_date}
          slotHint={t(dict.join.slot_hint, { date })}
        />
      ) : (
        <Card>{dict.join.closed}</Card>
      )}
    </div>
  );
}
