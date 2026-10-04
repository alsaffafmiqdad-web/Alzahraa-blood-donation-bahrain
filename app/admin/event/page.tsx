import { requireAdmin } from "@/lib/auth";
import { AdminShell } from "@/components/admin/AdminShell";
import { QueueStartForm } from "@/components/admin/QueueStartForm";
import { EventForm, type EventValues } from "@/components/admin/EventForm";

export const dynamic = "force-dynamic";

export default async function EventPage() {
  const { supabase, displayName } = await requireAdmin();
  const { data } = await supabase
    .from("event")
    .select("name_ar, name_en, location_ar, location_en, event_date, event_start_time, queue_start, public_registration_open, queue_counter")
    .single();
  const e = data as (EventValues & { queue_counter: number; queue_start: number }) | null;
  const next = e ? Math.max(e.queue_counter + 1, e.queue_start) : 1;
  return (
    <AdminShell displayName={displayName} wide={false}>
      <h1 className="mb-4 text-2xl font-bold">Event</h1>
      {e ? (
        <>
          <p className="mb-1 text-sm text-ink-soft">Queue numbers issued so far: {e.queue_counter}</p>
          <p className="mb-4 text-sm text-ink-soft">Next queue number: {next}.</p>
          <EventForm event={e} />
          <section className="mt-8">
            <h2 className="mb-3 text-lg font-bold">Queue numbers</h2>
            <QueueStartForm queueStart={e.queue_start} nextNumber={next} />
          </section>
        </>
      ) : (
        <p className="text-crimson">Could not load the event.</p>
      )}
    </AdminShell>
  );
}
