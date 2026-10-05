/* Isomorphic and pure: the three date-of-birth fields of the signup form. */
import { AGE_MIN } from "@/lib/config";
import { toAsciiDigits } from "@/lib/cpr";
import { isRealDate } from "@/lib/validation";

export type DobParts = { day: string; month: string; year: string };

/** Arabic-Indic to ASCII, digits only, cut to `max`. */
export function cleanDobPart(raw: string, max: 2 | 4): string {
  return toAsciiDigits(raw).replace(/[^0-9]/g, "").slice(0, max);
}

/** "" if all empty, else `${year}-${mm}-${dd}` (day and month zero-padded). */
export function composeDob(p: DobParts): string {
  if (!p.day && !p.month && !p.year) return "";
  return `${p.year}-${p.month.padStart(2, "0")}-${p.day.padStart(2, "0")}`;
}

/** "dob_required" when all empty, "dob_incomplete" when any is empty or the year is not 4 digits. */
export function dobPartsError(p: DobParts): "dob_required" | "dob_incomplete" | null {
  if (!p.day && !p.month && !p.year) return "dob_required";
  if (!p.day || !p.month || !p.year || p.year.length !== 4) return "dob_incomplete";
  return null;
}

/** The date of birth of someone who turns `minAge` on the event date. 29 Feb becomes 28 Feb. */
export function dobExample(eventDate: string, minAge: number = AGE_MIN): DobParts {
  const [y = 2026, m = 1, d = 1] = eventDate.split("-").map(Number);
  const year = y - minAge;
  let day = d;
  if (m === 2 && d === 29) {
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    if (!leap) day = 28;
  }
  return { day: String(day).padStart(2, "0"), month: String(m).padStart(2, "0"), year: String(year).padStart(4, "0") };
}

/** "YYYY-MM-DD" (a real date) to zero-padded parts; null for "" or anything invalid. */
export function isoToDobParts(iso: string): DobParts | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m || !isRealDate(iso)) return null;
  return { year: m[1]!, month: m[2]!, day: m[3]! };
}
