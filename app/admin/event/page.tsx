import { requireAdmin } from "@/lib/auth";
import { getSiteSettings } from "@/lib/db/public";
import { getStatusLabels } from "@/lib/db/status-labels";
import { AdminShell } from "@/components/admin/AdminShell";
import { OgImageForm } from "@/components/admin/OgImageForm";
import { QueueStartForm } from "@/components/admin/QueueStartForm";
import { StatusLabelsForm } from "@/components/admin/StatusLabelsForm";
import { ThemeForm } from "@/components/admin/ThemeForm";
import { EventForm, type EventValues } from "@/components/admin/EventForm";

export const dynamic = "force-dynamic";

export default async function EventPage() {
  const { supabase, displayName } = await requireAdmin();
  const [{ data }, labels, settings] = await Promise.all([
    supabase
      .from("event")
      .select(
        "name_ar, name_en, location_ar, location_en, event_date, event_start_time, queue_start, public_registration_open, queue_counter, whatsapp_number, theme_accent, theme_background, og_image_path",
      )
      .single(),
    getStatusLabels(supabase),
    getSiteSettings(),
  ]);
  const e = data as
    | (EventValues & {
        queue_counter: number;
        queue_start: number;
        theme_accent: string;
        theme_background: string;
        og_image_path: string | null;
      })
    | null;
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
          <section className="mt-8">
            <h2 className="mb-3 text-lg font-bold">Colours</h2>
            <ThemeForm accent={e.theme_accent} background={e.theme_background} />
          </section>
          <section className="mt-8">
            <h2 className="mb-3 text-lg font-bold">Link preview image</h2>
            <OgImageForm currentUrl={settings.ogImageUrl} />
          </section>
          <section className="mt-8">
            <h2 className="mb-3 text-lg font-bold">Status names</h2>
            <StatusLabelsForm labels={labels} />
          </section>
        </>
      ) : (
        <p className="text-danger">Could not load the event.</p>
      )}
    </AdminShell>
  );
}
