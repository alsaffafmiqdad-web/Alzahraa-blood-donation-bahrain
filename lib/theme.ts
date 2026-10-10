/* Isomorphic and pure: the admin-managed theme colours. */

export type Theme = { accent: string; background: string };
export const DEFAULT_THEME: Theme = { accent: "#093f4c", background: "#fbf7f2" };
export const INK = "#241f1c";
export const HEX_COLOR_RE = /^#[0-9a-f]{6}$/;

export function normalizeHex(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim().toLowerCase();
  return HEX_COLOR_RE.test(s) ? s : null;
}

function channels(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2 contrast ratio, rounded to 6 places to hide floating point noise. */
export function contrastRatio(a: string, b: string): number {
  const [la, lb] = [luminance(a), luminance(b)];
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return Math.round(((hi + 0.05) / (lo + 0.05)) * 1e6) / 1e6;
}

export function mixHex(a: string, b: string, weightB: number): string {
  const ca = channels(a);
  const cb = channels(b);
  const mixed = ca.map((v, i) => Math.round(v * (1 - weightB) + (cb[i] ?? 0) * weightB));
  return `#${mixed.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

export function isUsableAccent(hex: string): boolean {
  return contrastRatio(hex, "#ffffff") >= 4.5;
}

export function isUsableBackground(hex: string): boolean {
  return contrastRatio(hex, INK) >= 4.5;
}

export function deriveTheme(t: Theme): { brand: string; brandDark: string; brandTint: string; paper: string } {
  return {
    brand: t.accent,
    brandDark: mixHex(t.accent, "#000000", 0.2),
    brandTint: mixHex(t.accent, "#ffffff", 0.9),
    paper: t.background,
  };
}

/** The CSS that overrides the colour tokens. Only validated #rrggbb values ever reach it. */
export function themeCss(t: Partial<Theme> | null | undefined): string {
  const accentIn = normalizeHex(t?.accent);
  const bgIn = normalizeHex(t?.background);
  const accent = accentIn && isUsableAccent(accentIn) ? accentIn : DEFAULT_THEME.accent;
  const background = bgIn && isUsableBackground(bgIn) ? bgIn : DEFAULT_THEME.background;
  const d = deriveTheme({ accent, background });
  return `html:root{--color-brand:${d.brand};--color-brand-dark:${d.brandDark};--color-brand-tint:${d.brandTint};--color-paper:${d.paper};--primary:${d.brand};--ring:${d.brand};--accent:${d.brandTint};--background:${d.paper};}`;
}
