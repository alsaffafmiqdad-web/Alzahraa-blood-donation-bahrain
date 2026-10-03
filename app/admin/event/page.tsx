import { requireAdmin } from "@/lib/auth";
import { AdminShell } from "@/components/admin/AdminShell";
import { EventForm, type EventValues } from "@/components/admin/EventForm";

export const dynamic = "force-dynamic";

export default async function EventPage() {
  const { supabase, displayName } = await requireAdmin();
  const { data } = await supabase
    .from("event")
    .select("name_ar, name_en, location_ar, location_en, event_date, public_registration_open, queue_counter")
    .single();
  const e = data as (EventValues & { queue_counter: number }) | null;
  return (
    <AdminShell displayName={displayName} wide={false}>
      <h1 className="mb-4 text-2xl font-bold">Event</h1>
      {e ? (
        <>
          <p className="mb-4 text-sm text-ink-soft">Queue numbers issued so far: {e.queue_counter}</p>
          <EventForm event={e} />
        </>
      ) : (
        <p className="text-crimson">Could not load the event.</p>
      )}
    </AdminShell>
  );
}
