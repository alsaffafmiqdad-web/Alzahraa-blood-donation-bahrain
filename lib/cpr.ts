/** Map Arabic-Indic (U+0660-0669) and Extended Arabic-Indic (U+06F0-06F9) digits to ASCII. */
export function toAsciiDigits(s: string): string {
  return s.replace(/[٠-٩۰-۹]/g, (ch) => {
    const code = ch.charCodeAt(0);
    return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
  });
}

/** ASCII digits, with spaces and hyphens stripped. */
export function normaliseDigits(s: string): string {
  return toAsciiDigits(s).replace(/[\s-]/g, "");
}

export function isValidCpr(s: string): boolean {
  return /^[0-9]{9}$/.test(normaliseDigits(s));
}

export function maskCpr(cpr: string): string {
  if (cpr.length <= 4) return "*".repeat(cpr.length);
  return "*".repeat(cpr.length - 4) + cpr.slice(-4);
}

/** For CPR inputs: ASCII digits only, at most 9. */
export function cprInput(s: string): string {
  return toAsciiDigits(s).replace(/[^0-9]/g, "").slice(0, 9);
}

/** For mobile inputs: ASCII digits only, a pasted Bahrain code (+973 / 00973) removed, at most 8. */
export function phoneInput(s: string): string {
  let d = toAsciiDigits(s).replace(/[^0-9]/g, "");
  if (d.length > 8 && d.startsWith("00973")) d = d.slice(5);
  else if (d.length > 8 && d.startsWith("973")) d = d.slice(3);
  return d.slice(0, 8);
}
