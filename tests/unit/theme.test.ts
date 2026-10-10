import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_THEME,
  contrastRatio,
  deriveTheme,
  isUsableAccent,
  isUsableBackground,
  mixHex,
  normalizeHex,
  themeCss,
} from "@/lib/theme";

describe("normalizeHex", () => {
  it.each([
    ["#093f4c", "#093f4c"],
    ["#093F4C", "#093f4c"],
    ["  #FBF7F2 ", "#fbf7f2"],
  ])("accepts %j", (input, out) => {
    expect(normalizeHex(input)).toBe(out);
  });
  it.each(["red", "#fff", "093f4c", "#093f4", "#093f4cc", "#ggg000", "", null, undefined, 5])("rejects %j", (v) => {
    expect(normalizeHex(v)).toBeNull();
  });
});

describe("contrast and mixing", () => {
  it("white on black is 21", () => {
    expect(contrastRatio("#ffffff", "#000000")).toBe(21);
    expect(contrastRatio("#000000", "#ffffff")).toBe(21);
  });
  it("the default accent is dark enough for white text, about 11.5:1", () => {
    expect(contrastRatio(DEFAULT_THEME.accent, "#ffffff")).toBeGreaterThan(11);
    expect(isUsableAccent(DEFAULT_THEME.accent)).toBe(true);
    expect(isUsableAccent("#ffff00")).toBe(false);
    expect(isUsableBackground(DEFAULT_THEME.background)).toBe(true);
    expect(isUsableBackground("#222222")).toBe(false);
  });
  it("mixHex rounds each channel", () => {
    expect(mixHex("#000000", "#ffffff", 0.5)).toBe("#808080");
    expect(mixHex("#093f4c", "#000000", 0)).toBe("#093f4c");
  });
});

describe("deriveTheme", () => {
  it("gives the dark and tint colours for the default accent", () => {
    const d = deriveTheme(DEFAULT_THEME);
    expect(d).toEqual({ brand: "#093f4c", brandDark: "#07323d", brandTint: "#e6eced", paper: "#fbf7f2" });
  });
});

describe("themeCss", () => {
  it("builds exactly the override rule for the defaults", () => {
    expect(themeCss(DEFAULT_THEME)).toBe(
      "html:root{--color-brand:#093f4c;--color-brand-dark:#07323d;--color-brand-tint:#e6eced;--color-paper:#fbf7f2;--primary:#093f4c;--ring:#093f4c;--accent:#e6eced;--background:#fbf7f2;}",
    );
  });
  it("falls back per field on invalid or unusable input", () => {
    expect(themeCss({ accent: "red", background: "#fff" })).toBe(themeCss(DEFAULT_THEME));
    expect(themeCss({ accent: "#ffff00", background: "#222222" })).toBe(themeCss(DEFAULT_THEME));
    expect(themeCss(null)).toBe(themeCss(DEFAULT_THEME));
    expect(themeCss(undefined)).toBe(themeCss(DEFAULT_THEME));
    const mixed = themeCss({ accent: "#1a237e", background: "bad" });
    expect(mixed).toContain("--color-brand:#1a237e;");
    expect(mixed).toContain("--color-paper:#fbf7f2;");
  });
  it("contains only validated #rrggbb values, even for hostile input", () => {
    const css = themeCss({ accent: "#093f4c;}body{display:none", background: "</style><script>" });
    const values = css
      .slice("html:root{".length, -1)
      .split(";")
      .filter(Boolean)
      .map((d) => d.slice(d.indexOf(":") + 1));
    expect(values.length).toBe(8);
    for (const v of values) expect(v).toMatch(/^#[0-9a-f]{6}$/);
    expect(css).not.toContain("<");
  });
  it("lowercases uppercase input", () => {
    expect(themeCss({ accent: "#093F4C" })).toContain("--color-brand:#093f4c;");
  });
});

describe("globals.css", () => {
  it("brand tokens equal the derived defaults", () => {
    const css = fs.readFileSync(path.resolve(import.meta.dirname, "../../app/globals.css"), "utf8");
    const d = deriveTheme(DEFAULT_THEME);
    expect(css).toMatch(new RegExp(`--color-brand:\\s*${d.brand}`, "i"));
    expect(css).toMatch(new RegExp(`--color-brand-dark:\\s*${d.brandDark}`, "i"));
    expect(css).toMatch(new RegExp(`--color-brand-tint:\\s*${d.brandTint}`, "i"));
    expect(css).toMatch(new RegExp(`--color-paper:\\s*${d.paper}`, "i"));
    expect(css).toMatch(new RegExp(`--primary:\\s*${d.brand}`, "i"));
    expect(css).toMatch(new RegExp(`--accent:\\s*${d.brandTint}`, "i"));
    expect(css).toMatch(new RegExp(`--ring:\\s*${d.brand}`, "i"));
  });
});
