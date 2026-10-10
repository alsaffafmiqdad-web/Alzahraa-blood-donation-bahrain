import { toAsciiDigits } from "@/lib/cpr";

/* Pure. */

/** "" for empty input, the digits for a valid number (8 local digits get the 973 prefix), null if invalid. */
export function normalizeWhatsAppNumber(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed === "") return "";
  let d = toAsciiDigits(trimmed).replace(/[\s\-()]/g, "");
  if (d.startsWith("+")) d = d.slice(1);
  else if (d.startsWith("00")) d = d.slice(2);
  if (!/^[0-9]+$/.test(d)) return null;
  if (d.length === 8) d = `973${d}`;
  return d.length >= 8 && d.length <= 15 ? d : null;
}

/** "https://wa.me/<digits>" or null when empty or invalid. */
export function whatsAppUrl(number: string | null | undefined): string | null {
  if (!number) return null;
  const n = normalizeWhatsAppNumber(number);
  return n ? `https://wa.me/${n}` : null;
}
