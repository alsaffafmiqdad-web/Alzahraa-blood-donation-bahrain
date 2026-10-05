import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../..");
const read = (f: string) => fs.readFileSync(path.join(root, f), "utf8");
function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) walk(rel, out);
    else if (/\.tsx?$/.test(e.name)) out.push(rel);
  }
  return out;
}

describe("plum tokens (R4)", () => {
  const css = read("app/globals.css");
  it("defines the plum brand, brand-dark and brand-tint", () => {
    expect(css).toMatch(/--color-brand:\s*#6b2c6b/i);
    expect(css).toMatch(/--color-brand-dark:\s*#561f56/i);
    expect(css).toMatch(/--color-brand-tint:\s*#f3e6f3/i);
  });
  it("defines separate danger tokens", () => {
    expect(css).toMatch(/--color-danger:/);
    expect(css).toMatch(/--color-danger-dark:/);
    expect(css).toMatch(/--color-danger-tint:/);
  });
  it("crimson/blush are used only by the drop mark, the Arabic tagline and the print form", () => {
    const files = [...walk("app"), ...walk("components")].filter((f) => !f.endsWith("PrintForm.tsx"));
    const hits: string[] = [];
    for (const f of files) {
      for (const line of read(f).split("\n")) {
        if (/(crimson|blush)/.test(line) && !/Droplet/.test(line) && !/الزهراء|text-lg font-bold text-crimson/.test(line)) {
          hits.push(`${f}: ${line.trim()}`);
        }
      }
    }
    expect(hits).toEqual([]);
  });
  it("uses no raw red utilities or hex colours in components", () => {
    const bad = [...walk("components")]
      .filter((f) => !f.endsWith("PrintForm.tsx"))
      .filter((f) => /\b(bg|text|border)-(red|rose)-\d/.test(read(f)));
    expect(bad).toEqual([]);
  });
});
