/* Isomorphic and pure: prefill the year and month of birth from the first four CPR digits (YYMM). */
import { toAsciiDigits } from "@/lib/cpr";

export type CprDobPrefill = { year: string; month: string };
/** true = the value was prefilled and has not been edited since. */
export type DobAuto = { month: boolean; year: boolean };
export type DobYm = { dobMonth: string; dobYear: string };

/**
 * Year and month from the first four CPR digits, or null when there are fewer than four digits
 * or the month is not 01 to 12. `today` is a Bahrain "YYYY-MM-DD" string. The year is 20YY unless
 * that is after today's year, then 19YY.
 */
export function dobPrefillFromCpr(cpr: string, today: string): CprDobPrefill | null {
  const digits = toAsciiDigits(cpr).replace(/[^0-9]/g, "");
  if (digits.length < 4) return null;
  const yy = digits.slice(0, 2);
  const month = digits.slice(2, 4);
  const m = Number(month);
  if (m < 1 || m > 12) return null;
  const thisYear = Number(today.slice(0, 4));
  const year = 2000 + Number(yy) <= thisYear ? `20${yy}` : `19${yy}`;
  return { year, month };
}

/** Fill or clear the month and year independently; a value the user typed is never touched. */
export function applyCprPrefill(
  fields: DobYm,
  auto: DobAuto,
  cpr: string,
  today: string,
): DobYm & { auto: DobAuto } {
  const p = dobPrefillFromCpr(cpr, today);
  let { dobMonth, dobYear } = fields;
  const next: DobAuto = { month: auto.month, year: auto.year };

  if (auto.month || dobMonth === "") {
    if (p) {
      dobMonth = p.month;
      next.month = true;
    } else if (auto.month) {
      dobMonth = "";
      next.month = false;
    }
  } else {
    next.month = false;
  }

  if (auto.year || dobYear === "") {
    if (p) {
      dobYear = p.year;
      next.year = true;
    } else if (auto.year) {
      dobYear = "";
      next.year = false;
    }
  } else {
    next.year = false;
  }

  return { dobMonth, dobYear, auto: next };
}

/** After a draft restore: a field counts as prefilled only if it is not empty and equals the CPR's value. */
export function autoFromRestored(fields: DobYm, cpr: string, today: string): DobAuto {
  const p = dobPrefillFromCpr(cpr, today);
  return {
    month: !!p && fields.dobMonth !== "" && fields.dobMonth === p.month,
    year: !!p && fields.dobYear !== "" && fields.dobYear === p.year,
  };
}
