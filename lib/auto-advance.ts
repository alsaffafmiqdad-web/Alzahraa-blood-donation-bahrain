import { toAsciiDigits } from "@/lib/cpr";

/** True when an input just became complete and focus should move on. */
export function shouldAdvance(next: string, prev: string, max: number, caretAtEnd: boolean): boolean {
  return caretAtEnd && next.length === max && next !== prev;
}

/**
 * True while raw phone input starts with a country code (+, 00 or 973) that phoneInput
 * hasn't stripped yet (it only strips past 8 digits). Advancing then would keep the code.
 */
export function typingCountryCode(raw: string): boolean {
  const s = toAsciiDigits(raw).replace(/[\s-]/g, "");
  return /^(\+|00|973)/.test(s) && s.replace(/[^0-9]/g, "").length <= 8;
}
