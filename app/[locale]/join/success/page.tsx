import Link from "next/link";
import { notFound } from "next/navigation";
import { CardDownload } from "@/components/public/CardDownload";
import { getEvent, getSlotAvailability } from "@/lib/db/public";
import { formatDate, formatSlot } from "@/lib/format";
import { getDictionary, isLocale, t } from "@/lib/i18n";

export const dynamic = "force-dynamic";

const EMAIL_STATES = ["sent", "queued", "none"] as const;
type EmailState = (typeof EMAIL_STATES)[number];

export default async function SuccessPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const sp = await searchParams;
  const dict = getDictionary(locale);
  const one = (k: string) => {
    const v = sp[k];
    return Array.isArray(v) ? v[0] : v;
  };

  const ref = one("ref");
  const slotRaw = one("slot");
  const emailRaw = one("email");
  const queueRaw = one("queue");
  const valid =
    !!ref &&
    /^[0-9A-F]{8}$/.test(ref) &&
    !!slotRaw &&
    (/^\d{1,5}$/.test(slotRaw) || slotRaw === "walk_in") &&
    !!emailRaw &&
    (EMAIL_STATES as readonly string[]).includes(emailRaw);

  let thanks = dict.success.thanks_generic;
  let slotText: string | null = null;
  try {
    const [event, slots] = await Promise.all([getEvent(), valid && slotRaw !== "walk_in" ? getSlotAvailability() : Promise.resolve([])]);
    thanks = t(dict.success.thanks, {
      event: locale === "ar" ? event.name_ar : event.name_en,
      date: formatDate(event.event_date, locale),
    });
    const slot = slots.find((s) => String(s.id) === slotRaw);
    if (slot) slotText = formatSlot(slot.startsAt, locale);
  } catch {
    // Fall back to the generic thank-you line.
  }

  const walkIn = valid && slotRaw === "walk_in";
  const queue = walkIn && queueRaw && /^[1-9]\d{0,5}$/.test(queueRaw) ? queueRaw : null;
  const emailState = valid ? (emailRaw as EmailState) : null;
  const emailMessage =
    emailState === "sent"
      ? dict.success.email_sent
      : emailState === "queued"
        ? dict.success.email_queued
        : emailState === "none"
          ? walkIn
            ? dict.success.email_none_walk_in
            : dict.success.email_none
          : null;

  return (
    <div className="space-y-5 text-center">
      <h1 className="text-2xl font-bold text-success">{dict.success.title}</h1>
      <p>{thanks}</p>
      {valid && (
        <div className="rounded-xl border border-line bg-white p-5">
          <p className="text-sm text-ink-soft">{dict.success.ref}</p>
          <p dir="ltr" className="text-3xl font-bold tracking-widest text-crimson">
            #{ref}
          </p>
          {walkIn && queue && (
            <>
              <p className="mt-3 text-sm text-ink-soft">{dict.success.queue}</p>
              <p dir="ltr" className="text-4xl font-bold text-crimson">
                #{queue}
              </p>
            </>
          )}
          {walkIn && !queue && (
            <>
              <p className="mt-3 text-sm text-ink-soft">{dict.success.slot}</p>
              <p className="text-xl font-bold">{dict.success.walk_in_value}</p>
            </>
          )}
          {slotText && (
            <>
              <p className="mt-3 text-sm text-ink-soft">{dict.success.slot}</p>
              <p className="text-xl font-bold">{slotText}</p>
            </>
          )}
        </div>
      )}
      {valid && <CardDownload dict={dict.success} />}
      {emailMessage && <p>{emailMessage}</p>}
      <p className="font-medium">{walkIn ? dict.success.walk_in : dict.success.bring_cpr}</p>
      <p className="text-sm text-ink-soft">{dict.common.disclaimer}</p>
      <p lang="ar" className="text-lg font-bold text-crimson">
        الزهراء عطاءٌ ممتد
      </p>
      <Link
        href={`/${locale}/join`}
        className="inline-block rounded-lg bg-crimson px-5 py-3 font-bold text-white hover:bg-crimson-dark"
      >
        {dict.success.another}
      </Link>
    </div>
  );
}
