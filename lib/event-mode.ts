import { clockInBahrain, todayInBahrain } from "@/lib/format";

/* Isomorphic: no server imports. */

export type EventTiming = { event_date: string; event_start_time?: string | null };

/** True on the event date (Asia/Bahrain) from the start time onwards (owner decision W1). The server's clock decides; never the client's. */
export function isWalkInMode(event: EventTiming, now: Date = new Date()): boolean {
  const start = event.event_start_time;
  if (typeof start !== "string" || !/^\d{2}:\d{2}/.test(start)) return false;
  return todayInBahrain(now) === event.event_date && clockInBahrain(now) >= start.slice(0, 5);
}
