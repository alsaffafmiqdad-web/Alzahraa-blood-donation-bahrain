import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../..");
const read = (f: string) => fs.readFileSync(path.join(root, f), "utf8");
function walk(dir: string, re = /\.(tsx?|mts|css|md|sql|json|mjs)$/): string[] {
  const abs = path.join(root, dir);
  if (!fs.existsSync(abs)) return [];
  const out: string[] = [];
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(rel, re));
    else if (re.test(e.name)) out.push(rel);
  }
  return out;
}
const src = [...walk("app"), ...walk("components"), ...walk("lib")].filter((f) => /\.tsx?$/.test(f));

/** Resolve a relative or "@/" import specifier to a repo-relative file, or null for packages. */
function resolveImport(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = spec.slice(2);
  else if (spec.startsWith(".")) base = path.join(path.dirname(from), spec);
  else return null;
  for (const c of [base, base + ".ts", base + ".tsx", path.join(base, "index.ts"), path.join(base, "index.tsx")]) {
    if (fs.existsSync(path.join(root, c)) && fs.statSync(path.join(root, c)).isFile()) return c;
  }
  return null;
}
function imports(f: string): string[] {
  const text = read(f);
  const specs = [...text.matchAll(/(?:import|export)\s[^'"]*?from\s*["']([^"']+)["']|import\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g)].map(
    (m) => m[1] ?? m[2] ?? m[3]!,
  );
  return specs.map((s) => resolveImport(f, s)).filter((x): x is string => !!x);
}
function closure(entry: string): Set<string> {
  const seen = new Set<string>();
  const stack = [entry];
  while (stack.length) {
    const f = stack.pop()!;
    if (seen.has(f)) continue;
    seen.add(f);
    // A "use server" module is an RPC boundary: the bundler turns imports of it into references.
    if (f !== entry && /^\s*["']use server["']/m.test(read(f).split("\n").slice(0, 3).join("\n"))) continue;
    stack.push(...imports(f));
  }
  return seen;
}

const clientFiles = src.filter((f) => /^\s*["']use client["']/m.test(read(f).split("\n").slice(0, 3).join("\n")));

describe("client components never reach server-only code", () => {
  it("finds the client components", () => {
    expect(clientFiles.length).toBeGreaterThanOrEqual(13);
  });
  const SERVER_ONLY = (f: string) =>
    /^lib\/(db|email|pdf)\//.test(f) ||
    ["lib/auth.ts", "lib/alert.ts", "lib/supabase/admin.ts", "lib/supabase/server.ts", "lib/rate-limit.ts", "lib/turnstile.ts"].includes(f);
  it.each(clientFiles)("%s: no server-only module in its import closure", (f) => {
    const bad = [...closure(f)].filter((x) => SERVER_ONLY(x) || read(x).includes('import "server-only"'));
    // Server actions (app/admin/actions.ts) are the only allowed bridge: they are 'use server' endpoints.
    expect(bad).toEqual([]);
  });
  it.each(clientFiles)("%s: reads no non-public env var and never names the service role key", (f) => {
    const t = read(f);
    expect(t).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY|TURNSTILE_SECRET|CRON_SECRET|RATE_LIMIT_SALT|RESEND_API_KEY|GMAIL_APP_PASSWORD|DISCORD_WEBHOOK_URL/);
    const envs = [...t.matchAll(/process\.env\.([A-Z0-9_]+)/g)].map((m) => m[1]!);
    expect(envs.filter((e) => !e.startsWith("NEXT_PUBLIC_") && e !== "NODE_ENV")).toEqual([]);
  });
  it("no client component pulls lib/env.ts (its zod schema names every server secret) into the browser bundle", () => {
    expect(clientFiles.filter((f) => closure(f).has("lib/env.ts"))).toEqual([]);
  });
});

describe("env naming", () => {
  it("no NEXT_PUBLIC_ variable carries a secret, anywhere", () => {
    const all = [...src, ".env.example", "README.md", "next.config.ts", "vercel.json", "supabase/config.toml"].filter((f) =>
      fs.existsSync(path.join(root, f)),
    );
    const names = new Set<string>();
    for (const f of all) for (const m of read(f).matchAll(/NEXT_PUBLIC_[A-Z0-9_]+/g)) names.add(m[0]);
    const allowed = new Set([
      "NEXT_PUBLIC_SITE_URL", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "NEXT_PUBLIC_TURNSTILE_SITE_KEY",
      "NEXT_PUBLIC_ORG_NAME", "NEXT_PUBLIC_ORG_CONTACT_EMAIL", "NEXT_PUBLIC_ORG_CONTACT_PHONE",
    ]);
    expect([...names].filter((n) => !allowed.has(n))).toEqual([]);
  });
  it("next.config does not expose env through `env:` inlining", () => {
    expect(read("next.config.ts")).not.toMatch(/\benv\s*:/);
  });
  it("the built client bundle (if present) names no server secret", () => {
    const dir = path.join(root, ".next/static");
    if (!fs.existsSync(dir)) return;
    const hits: string[] = [];
    const scan = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) scan(p);
        else if (/\.(js|css|map)$/.test(e.name) && /SUPABASE_SERVICE_ROLE_KEY|TURNSTILE_SECRET_KEY|CRON_SECRET|RATE_LIMIT_SALT|RESEND_API_KEY|GMAIL_APP_PASSWORD|DISCORD_WEBHOOK_URL|service_role/.test(fs.readFileSync(p, "utf8")))
          hits.push(path.relative(root, p));
      }
    };
    scan(dir);
    expect(hits).toEqual([]);
  });
});

describe("screening is only recent_donation and on_medication", () => {
  const FORBIDDEN = /feel[_ -]?well|feelWell|not_feeling|recent[_ ]?procedure|recentProcedure|recent[_ ]?travel|recentTravel|tattoo|piercing|surgery|\btravel(l?ed|ling)?\b|وشم|سفر/i;
  const targets = [
    ...src,
    ...walk("supabase", /\.(sql|toml)$/),
    ...walk("lib/i18n"),
    "README.md",
    ".env.example",
  ];
  it.each(targets.filter((f) => !f.includes("components/ui/")))("%s mentions no dropped screening topic", (f) => {
    const t = read(f)
      .split("\n")
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)) // comments are not copy
      .join("\n");
    const m = t.match(FORBIDDEN);
    expect(m ? `${f}: ${m[0]}` : null).toBeNull();
  });
  it("the donors table has exactly the two q_ columns", () => {
    const sql = read("supabase/migrations/20261003000000_init.sql");
    const cols = [...sql.matchAll(/^\s+(q_[a-z_]+)\s/gm)].map((m) => m[1]);
    expect(cols).toEqual(["q_recent_donation", "q_on_medication"]);
  });
});

describe("no em or en dashes in user-facing copy", () => {
  const DASH = /[–—―]|&mdash;|&ndash;|&#8212;|&#8211;|&#x2014;|&#x2013;|\\u201[345]|\\u2013/i;
  const copy = [
    ...walk("lib/i18n"),
    ...walk("lib/email"),
    ...walk("lib/pdf"),
    ...walk("components/public"),
    ...walk("components/admin"),
    ...walk("app"),
    "README.md",
  ];
  it.each(copy)("%s has none", (f) => {
    expect(read(f).match(DASH)?.[0] ?? null).toBeNull();
  });
});
