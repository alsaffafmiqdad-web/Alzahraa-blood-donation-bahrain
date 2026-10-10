import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../..");

function files(dir: string, exts = /\.(tsx?|css)$/): string[] {
  const out: string[] = [];
  const abs = path.join(root, dir);
  if (!fs.existsSync(abs)) return out;
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...files(rel, exts));
    else if (exts.test(e.name)) out.push(rel);
  }
  return out;
}
const read = (f: string) => fs.readFileSync(path.join(root, f), "utf8");

describe("source rules", () => {
  it("public components use logical (RTL-safe) utilities only", () => {
    const bad = [...files("components/public"), ...files("app/[locale]")].filter((f) =>
      /(^|[\s"'`])(ml|mr|pl|pr|left|right)-[\w\[]|text-(left|right)\b/.test(read(f)),
    );
    expect(bad).toEqual([]);
  });
  it("uses dangerouslySetInnerHTML only for the validated theme CSS in the two root layouts", () => {
    const allowed = ["app/[locale]/layout.tsx", "app/admin/layout.tsx"];
    const used = [...files("app"), ...files("components"), ...files("lib")].filter((f) =>
      read(f).includes("dangerouslySetInnerHTML"),
    );
    expect(used.sort()).toEqual(allowed.sort());
    for (const f of allowed) expect(read(f), f).toContain("__html: themeCss(settings)");
  });
  it("keeps the service role key in lib/env.ts and lib/supabase/admin.ts only", () => {
    const hits = [...files("app"), ...files("components"), ...files("lib"), "proxy.ts"].filter((f) =>
      read(f).includes("SUPABASE_SERVICE_ROLE_KEY"),
    );
    expect(hits.sort()).toEqual(["lib/env.ts", "lib/supabase/admin.ts"].sort());
  });
  it("marks server-only modules", () => {
    const need = [...files("lib/db"), ...files("lib/email"), ...files("lib/pdf"), "lib/supabase/admin.ts", "lib/auth.ts"];
    const missing = need.filter((f) => !read(f).includes('import "server-only"'));
    expect(missing).toEqual([]);
  });
  it("has no NEXT_PUBLIC secrets", () => {
    const env = read(".env.example");
    expect(env).not.toMatch(/NEXT_PUBLIC_[A-Z_]*(SECRET|SERVICE)/);
  });
  it("does not ask or store the dropped screening questions anywhere", () => {
    const hits = [...files("app"), ...files("components"), ...files("lib"), "supabase/migrations/20261003000000_init.sql"].filter(
      (f) => /feel_well|feelWell|recent_procedure|recentProcedure|recent_travel|recentTravel/.test(read(f)),
    );
    expect(hits).toEqual([]);
  });
});
