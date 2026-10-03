import { TIMEZONE } from "@/lib/config";
import type { Locale } from "@/lib/i18n";

function intlLocale(locale: Locale): string {
  return locale === "ar" ? "ar-u-nu-latn" : "en-GB";
}

/** First 8 hex chars of the uuid without dashes, uppercase. */
export function shortRef(id: string): string {
  return id.replace(/-/g, "").slice(0, 8).toUpperCase();
}

/** `time` is HH:MM[:SS], a Bahrain local time. */
export function formatSlot(time: string, locale: Locale): string {
  const [h = "0", m = "0"] = time.split(":");
  const d = new Date(Date.UTC(2026, 0, 1, Number(h), Number(m)));
  return new Intl.DateTimeFormat(intlLocale(locale), {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "UTC",
  }).format(d);
}

/** `date` is YYYY-MM-DD. */
export function formatDate(date: string, locale: Locale): string {
  const [y = 1970, mo = 1, d = 1] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, d, 9));
  return new Intl.DateTimeFormat(intlLocale(locale), {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: TIMEZONE,
  }).format(dt);
}

/** ISO timestamp to Bahrain date and time, Latin digits (admin, English). */
export function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: TIMEZONE,
  }).format(new Date(iso));
}

export function formatDateShort(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: TIMEZONE,
  }).format(new Date(iso));
}

export function formatClock(d: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: TIMEZONE,
  }).format(d);
}

/** Today in Bahrain as YYYY-MM-DD. */
export function todayInBahrain(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: TIMEZONE,
  }).format(now);
  return parts;
}
