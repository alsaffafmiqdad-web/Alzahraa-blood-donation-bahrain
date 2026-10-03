import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ar } from "@/lib/i18n/dictionaries/ar";
import { en } from "@/lib/i18n/dictionaries/en";
import { dirFor, getDictionary, isLocale, t } from "@/lib/i18n";

function flatten(o: Record<string, unknown>, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(o)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") out[key] = v;
    else Object.assign(out, flatten(v as Record<string, unknown>, key));
  }
  return out;
}
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("dictionaries", () => {
  const fe = flatten(en);
  const fa = flatten(ar);
  it("have identical key sets", () => {
    expect(Object.keys(fa).sort()).toEqual(Object.keys(fe).sort());
  });
  it("have no empty strings", () => {
    for (const [k, v] of Object.entries(fe)) expect(v.trim(), `en ${k}`).not.toBe("");
    for (const [k, v] of Object.entries(fa)) expect(v.trim(), `ar ${k}`).not.toBe("");
  });
  it("have matching placeholders", () => {
    for (const k of Object.keys(fe)) expect(placeholders(fa[k]!), k).toEqual(placeholders(fe[k]!));
  });
  it("contain no en or em dashes", () => {
    for (const v of [...Object.values(fe), ...Object.values(fa)]) expect(v).not.toMatch(/[–—]/);
  });
  it("only has the two owner-approved screening questions", () => {
    const keys = Object.keys(en.screening).filter((k) => !["title", "yes", "no", "hint"].includes(k));
    expect(keys.sort()).toEqual(["onMedication", "recentDonation"]);
    expect(Object.keys(en.flags).sort()).toEqual(["age_out_of_range", "on_medication", "recent_donation"]);
  });
  it("keeps the existing Arabic wording for the two questions", () => {
    expect(ar.screening.recentDonation).toBe("تبرعت بالدم خلال 3 أشهر؟");
    expect(ar.screening.onMedication).toBe("تتناول مضادات حيوية أو أدوية؟");
  });
});

describe("i18n helpers", () => {
  it("t replaces placeholders", () => {
    expect(t("Hi {name}, {n}", { name: "Ali", n: 3 })).toBe("Hi Ali, 3");
    expect(t("Hi {name}")).toBe("Hi {name}");
  });
  it("locale helpers", () => {
    expect(isLocale("ar")).toBe(true);
    expect(isLocale("fr")).toBe(false);
    expect(dirFor("ar")).toBe("rtl");
    expect(dirFor("en")).toBe("ltr");
    expect(getDictionary("ar")).toBe(ar);
  });
});

describe("source tree", () => {
  it("has no en or em dash in app, components or lib", () => {
    const root = path.resolve(__dirname, "../..");
    const bad: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(tsx?|css|mts|mjs)$/.test(e.name) && /[–—]/.test(fs.readFileSync(p, "utf8")))
          bad.push(path.relative(root, p));
      }
    };
    for (const d of ["app", "components", "lib"]) walk(path.join(root, d));
    expect(bad).toEqual([]);
  });
});
