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
