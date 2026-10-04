"use client";

import { useActionState } from "react";
import { updateEvent } from "@/app/admin/actions";
import { initialFormState } from "@/app/admin/action-types";
import { Button } from "@/components/ui/button";

export type EventValues = {
  name_ar: string;
  name_en: string;
  location_ar: string;
  location_en: string;
  event_date: string;
  event_start_time: string;
  public_registration_open: boolean;
};

const inputCls = "w-full rounded-md border border-line bg-white px-3 py-2 text-sm";

export function EventForm({ event }: { event: EventValues }) {
  const [state, action, pending] = useActionState(updateEvent, initialFormState);
  const fe = state.fieldErrors ?? {};
  const field = (name: keyof EventValues, label: string, opts: { dir?: "rtl"; type?: string } = {}) => (
    <div>
      <label htmlFor={name} className="mb-1 block text-sm font-medium">
        {label}
      </label>
      <input
        id={name}
        name={name}
        type={opts.type ?? "text"}
        dir={opts.dir}
        defaultValue={String(event[name])}
        className={inputCls}
      />
      {fe[name] && <p className="mt-1 text-sm text-crimson">{fe[name]}</p>}
    </div>
  );
  return (
    <form action={action} className="space-y-4">
      {field("name_en", "Event name (English)")}
      {field("name_ar", "Event name (Arabic)", { dir: "rtl" })}
      {field("location_en", "Location (English)")}
      {field("location_ar", "Location (Arabic)", { dir: "rtl" })}
      {field("event_date", "Event date", { type: "date" })}
      <div>
        <label htmlFor="event_start_time" className="mb-1 block text-sm font-medium">
          Start time (Bahrain time)
        </label>
        <input
          id="event_start_time"
          name="event_start_time"
          type="time"
          defaultValue={event.event_start_time.slice(0, 5)}
          aria-describedby="event_start_time-hint"
          className={inputCls}
        />
        <p id="event_start_time-hint" className="mt-1 text-sm text-ink-soft">
          On the event date, from this time, the public link registers donors as walk-ins, gives each one the next queue number, and does not ask them to choose a time.
        </p>
        {fe.event_start_time && <p className="mt-1 text-sm text-crimson">{fe.event_start_time}</p>}
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="public_registration_open"
          defaultChecked={event.public_registration_open}
          className="size-4 accent-crimson"
        />
        Public registration is open
      </label>
      {state.error && <p role="alert" className="text-sm text-crimson">{state.error}</p>}
      {state.ok && state.message && <p role="status" className="text-sm text-success">{state.message}</p>}
      <Button type="submit" disabled={pending}>
        {pending ? "Saving..." : "Save event"}
      </Button>
    </form>
  );
}
