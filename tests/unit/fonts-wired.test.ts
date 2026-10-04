import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");
function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === ".next") continue;
      walk(rel, out);
    } else out.push(rel);
  }
  return out;
}

describe("IBM Plex is fully gone", () => {
  it("no plex references in app, components, lib or the README", () => {
    const hits = [...walk("app"), ...walk("components"), ...walk("lib"), "README.md"].filter((f) =>
      /plex/i.test(f) || (/\.(tsx?|css|md|json)$/.test(f) && /plex/i.test(read(f))),
    );
    expect(hits).toEqual([]);
  });
  it("Plex font files and its OFL licence are deleted", () => {
    expect(fs.existsSync(path.join(root, "assets/fonts/IBMPlexSansArabic-Regular.ttf"))).toBe(false);
    expect(fs.existsSync(path.join(root, "assets/fonts/IBMPlexSansArabic-Bold.ttf"))).toBe(false);
    expect(fs.existsSync(path.join(root, "assets/fonts/OFL.txt"))).toBe(false);
  });
});

describe("Thmanyah fonts are wired", () => {
  it("every referenced font file exists", () => {
    const files = [
      ...[...read("app/fonts.ts").matchAll(/path:\s*"([^"]+)"/g)].map((x) => path.join("app", x[1]!)),
      ...[...read("lib/pdf/fonts.ts").matchAll(/"((?:thmanyah)[^"]+\.otf)"/g)].map((x) => path.join("assets/fonts", x[1]!)),
    ];
    expect(files.length).toBeGreaterThanOrEqual(9);
    for (const f of files) expect(fs.existsSync(path.join(root, f)), f).toBe(true);
  });
  it("all three layouts put both font variables on <html> and no font class on <body>", () => {
    for (const f of ["app/[locale]/layout.tsx", "app/admin/layout.tsx", "app/global-not-found.tsx"]) {
      const s = read(f);
      expect(s, f).toContain("thmanyahSans.variable");
      expect(s, f).toContain("thmanyahDisplay.variable");
      expect(s, f).not.toMatch(/<body[^>]*(thmanyah\w+)\.className/);
    }
  });
  it("css maps sans and heading to Thmanyah and applies the heading font to h1-h6", () => {
    const css = read("app/globals.css");
    expect(css).toMatch(/--font-sans:\s*var\(--font-thmanyah-sans\)/);
    expect(css).toMatch(/--font-heading:\s*var\(--font-thmanyah-display\)/);
    expect(css).toMatch(/h1,\s*h2,\s*h3,\s*h4,\s*h5,\s*h6\s*{[^}]*font-heading/);
  });
  it("the select chevron rule is unlayered (not inside @layer)", () => {
    const css = read("app/globals.css");
    const i = css.indexOf("select:not([multiple])");
    expect(i).toBeGreaterThan(-1);
    // brace depth at that position must be 0
    let depth = 0;
    for (const ch of css.slice(0, i)) depth += ch === "{" ? 1 : ch === "}" ? -1 : 0;
    expect(depth).toBe(0);
    expect(css).toMatch(/padding-inline-end:\s*2\.25rem/);
  });
  it("pdf registers ThmanyahSans and ThmanyahDisplay and the registration form PDF uses them", () => {
    expect(read("lib/pdf/fonts.ts")).toMatch(/family:\s*"ThmanyahSans"/);
    expect(read("lib/pdf/fonts.ts")).toMatch(/family:\s*"ThmanyahDisplay"/);
    const card = read("lib/pdf/RegistrationForm.tsx");
    expect(card).toContain('"ThmanyahSans"');
    expect(card).toContain('"ThmanyahDisplay"');
  });
});
