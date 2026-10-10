import { notFound } from "next/navigation";
import { reportAlert } from "@/lib/alert";
import { getEvent, getSiteSettings, getSlotAvailability, type EventRow, type SlotAvailability } from "@/lib/db/public";
import { whatsAppUrl } from "@/lib/whatsapp";
import { isWalkInMode } from "@/lib/event-mode";
import { formatDate, formatSlot } from "@/lib/format";
import { getDictionary, isLocale, t } from "@/lib/i18n";
import { EventIntro } from "@/components/public/EventIntro";
import { PageShell } from "@/components/public/PageShell";
import { SignupForm } from "@/components/public/SignupForm";

export const dynamic = "force-dynamic";

export default async function JoinPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const dict = getDictionary(locale);
  const whatsappUrl = whatsAppUrl((await getSiteSettings()).whatsappNumber);

  let event: EventRow;
  let slots: SlotAvailability[];
  try {
    [event, slots] = await Promise.all([getEvent(), getSlotAvailability()]);
  } catch (e) {
    const message = e instanceof Error ? e.message : "unknown";
    console.error(`join page load failed: ${message}`);
    reportAlert({ event: "join_load_failed", detail: message });
    return (
      <PageShell locale={locale} dict={dict} whatsappUrl={whatsappUrl}>
        <div className="rounded-2xl border border-line bg-white p-5 text-ink">{dict.join.unavailable}</div>
      </PageShell>
    );
  }

  const name = locale === "ar" ? event.name_ar : event.name_en;
  const location = locale === "ar" ? event.location_ar : event.location_en;
  const dateText = formatDate(event.event_date, locale);
  const timeText = formatSlot(event.event_start_time, locale);
  const walkIn = isWalkInMode(event, new Date());
  const summary = { name, dateText, timeText, location };

  if (!event.public_registration_open) {
    return (
      <PageShell locale={locale} dict={dict} whatsappUrl={whatsappUrl}>
        <EventIntro dict={dict} event={summary} walkIn={walkIn} closed />
      </PageShell>
    );
  }

  return (
    <SignupForm
      locale={locale}
      dict={dict}
      slots={walkIn ? [] : slots}
      walkIn={walkIn}
      eventDate={event.event_date}
      slotHint={t(dict.join.slot_hint, { date: dateText })}
      event={summary}
      whatsappUrl={whatsappUrl}
    />
  );
}
