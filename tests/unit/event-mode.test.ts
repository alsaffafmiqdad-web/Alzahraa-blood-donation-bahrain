import { describe, expect, it } from "vitest";
import { isWalkInMode } from "@/lib/event-mode";
import { clockInBahrain } from "@/lib/format";

const event = { event_date: "2026-10-16", event_start_time: "08:30:00" };

describe("isWalkInMode", () => {
  it.each([
    ["2026-10-16T05:29:00Z", false],
    ["2026-10-16T05:30:00Z", true],
    ["2026-10-16T20:59:00Z", true],
    ["2026-10-16T21:00:00Z", false],
    ["2026-10-15T21:00:00Z", false],
  ])("%s -> %s", (now, expected) => {
    expect(isWalkInMode(event, new Date(now))).toBe(expected);
  });
  it("is false without a start time", () => {
    const now = new Date("2026-10-16T09:00:00Z");
    expect(isWalkInMode({ event_date: "2026-10-16" }, now)).toBe(false);
    expect(isWalkInMode({ event_date: "2026-10-16", event_start_time: null }, now)).toBe(false);
  });
  it("clockInBahrain gives 00:00 at midnight, never 24:00", () => {
    expect(clockInBahrain(new Date("2026-10-15T21:00:00Z"))).toBe("00:00");
  });
});
