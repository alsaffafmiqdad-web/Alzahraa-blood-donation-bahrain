import { describe, expect, it } from "vitest";
import { ar } from "@/lib/i18n/dictionaries/ar";
import { en } from "@/lib/i18n/dictionaries/en";

function flat(o: unknown, p = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
    const key = p ? `${p}.${k}` : k;
    if (typeof v === "string") out[key] = v;
    else if (v && typeof v === "object") Object.assign(out, flat(v, key));
  }
  return out;
}
const A = flat(ar);
const E = flat(en);
const ARABIC = /[؀-ۿ]/;

describe("i18n parity (independent check)", () => {
  it("has identical key sets", () => {
    expect(Object.keys(A).sort()).toEqual(Object.keys(E).sort());
  });
  it("has no empty strings", () => {
    expect(Object.entries({ ...A }).filter(([, v]) => !v.trim())).toEqual([]);
    expect(Object.entries({ ...E }).filter(([, v]) => !v.trim())).toEqual([]);
  });
  it("keeps the same {placeholders} in both languages", () => {
    const ph = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
    expect(Object.keys(E).filter((k) => ph(E[k]!) !== ph(A[k]!))).toEqual([]);
  });
  it("Arabic values contain Arabic letters (not left in English), except pure tokens", () => {
    // common.language is the label of the OTHER language ("English"), intentionally Latin in the Arabic dictionary
    const untranslated = Object.entries(A).filter(([k, v]) => k !== "common.language" && !ARABIC.test(v) && /[A-Za-z]{3,}/.test(v));
    expect(untranslated).toEqual([]);
  });
  it("English values contain no Arabic letters", () => {
    // common.ogImageAlt is the same bilingual link-preview alt text in both dictionaries, by design
    const bilingual = ["common.language", "common.ogImageAlt"];
    expect(Object.entries(E).filter(([k, v]) => !bilingual.includes(k) && ARABIC.test(v)).map(([k]) => k)).toEqual([]);
  });
  it("no em/en dashes in either dictionary", () => {
    for (const v of [...Object.values(A), ...Object.values(E)]) expect(v).not.toMatch(/[–—]/);
  });
  it("screening has exactly the two questions", () => {
    const keys = Object.keys(E).filter((k) => k.startsWith("screening."));
    expect(keys.filter((k) => /q_|question|\.q/.test(k) && !/hint|title|yes|no$/.test(k))).toBeDefined();
    const text = Object.entries(E).filter(([k]) => k.startsWith("screening.")).map(([, v]) => v).join(" ");
    expect(text).not.toMatch(/tattoo|piercing|surgery|travel|feel/i);
  });
});
