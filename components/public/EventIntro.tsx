import { CalendarDays, Clock, IdCard, MapPin } from "lucide-react";
import type { Dictionary } from "@/lib/i18n";

type Icon = typeof CalendarDays;

function Row({ icon: Icon, label, value }: { icon: Icon; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 p-4">
      <Icon className="size-5 text-brand" aria-hidden="true" />
      <dt className="text-sm text-ink-soft">{label}</dt>
      <dd className="ms-auto font-medium">{value}</dd>
    </div>
  );
}

/** The summary screen shown before the form: event name, date, start time and location. */
export function EventIntro({
  dict,
  event,
  walkIn,
  closed,
}: {
  dict: Dictionary;
  event: { name: string; dateText: string; timeText: string; location: string };
  walkIn: boolean;
  closed?: boolean;
}) {
  return (
    <section aria-labelledby="intro-title" className="space-y-6">
      <p className="text-sm font-medium text-brand">{dict.join.intro_eyebrow}</p>
      <h1
        id="intro-title"
        tabIndex={-1}
        className="font-heading font-swash text-4xl leading-tight font-bold text-ink focus:outline-none"
      >
        {event.name}
      </h1>
      <dl className="divide-y divide-line rounded-2xl border border-line bg-white">
        <Row icon={CalendarDays} label={dict.join.intro_date} value={event.dateText} />
        <Row icon={Clock} label={dict.join.intro_time} value={event.timeText} />
        {event.location && <Row icon={MapPin} label={dict.join.intro_location} value={event.location} />}
      </dl>
      {!closed && (
        <section aria-labelledby="intro-docs-title" className="space-y-3">
          <h2 id="intro-docs-title" className="text-lg font-bold text-ink">
            {dict.join.intro_docs_title}
          </h2>
          <ul className="divide-y divide-line rounded-2xl border border-line bg-white">
            <li className="flex items-center gap-3 p-4">
              <IdCard className="size-5 text-brand" aria-hidden="true" />
              <span className="font-medium">{dict.join.intro_doc_cpr}</span>
            </li>
          </ul>
        </section>
      )}
      {walkIn && !closed && <p className="rounded-xl bg-brand-tint p-4">{dict.join.walk_in_notice}</p>}
      {closed ? (
        <p role="status" className="rounded-xl border border-line bg-white p-4">
          {dict.join.closed}
        </p>
      ) : (
        <p className="text-ink-soft">{dict.join.intro_lead}</p>
      )}
    </section>
  );
}
