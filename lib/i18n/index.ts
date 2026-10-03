import { LOCALES } from "@/lib/config";
import { ar } from "./dictionaries/ar";
import { en } from "./dictionaries/en";

export type Locale = "ar" | "en";
type Shape<T> = { [K in keyof T]: T[K] extends string ? string : Shape<T[K]> };
export type Dictionary = Shape<typeof en>;

export function isLocale(x: string): x is Locale {
  return (LOCALES as readonly string[]).includes(x);
}

export function getDictionary(l: Locale): Dictionary {
  return l === "ar" ? ar : en;
}

export function dirFor(l: Locale): "rtl" | "ltr" {
  return l === "ar" ? "rtl" : "ltr";
}

/** Replace {name} placeholders. Unknown placeholders are left as is. */
export function t(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}
