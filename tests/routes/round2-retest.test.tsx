import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

/** Independent re-test of fix round 2 (tester). Behaviour only, mocks at the module boundary. */
class RedirectError extends Error {
  constructor(public to: string) {
    super(`NEXT_REDIRECT:${to}`);
  }
}
const h = vi.hoisted(() => ({ supabase: null as unknown }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new RedirectError(to);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/link", () => ({ default: () => null }));
vi.mock("@/lib/auth", () => ({ requireAdmin: async () => ({ supabase: h.supabase, userId: "u", displayName: "A" }) }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: vi.fn() }));
vi.mock("@/lib/email/dispatch", () => ({ sendDonorEmail: vi.fn() }));

import { searchDonors } from "@/app/admin/actions";
import { signupClientSchema, signupSchema } from "@/lib/validation";
import { checkInNotice } from "@/lib/check-in-notice";
import type { CheckInResult } from "@/app/admin/action-types";

const ROOT = path.resolve(import.meta.dirname, "../..");
const fd = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};
async function searchTo(q: string): Promise<string> {
  try {
    await searchDonors(fd({ q }));
  } catch (e) {
    if (e instanceof RedirectError) return e.to;
    throw e;
  }
  throw new Error("no redirect");
}

describe("L6 no CPR in a URL", () => {
  it.each(["990101123", " 990101123 ", "990-101-123", "990 101 123", "٩٩٠١٠١١٢٣", "۹۹۰۱۰۱۱۲۳"])(
    "search %j redirects without the full CPR",
    async (q) => {
      const to = await searchTo(q);
      expect(to).toBe("/admin?q=1123");
      expect(decodeURIComponent(to)).not.toMatch(/990\D*101\D*123/);
    },
  );
  it("a normal name search is untouched", async () => {
    expect(await searchTo("Ali")).toBe("/admin?q=Ali");
  });
  it("a short digit search (last 4) is untouched", async () => {
    expect(await searchTo("1123")).toBe("/admin?q=1123");
  });
  it("no source file puts a CPR into a href, router push/replace or redirect", () => {
    const files: string[] = [];
    const walk = (d: string) => {
      for (const n of readdirSync(d)) {
        const p = path.join(d, n);
        if (n === "node_modules" || n === ".next") continue;
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(n)) files.push(p);
      }
    };
    for (const d of ["app", "components", "lib"]) walk(path.join(ROOT, d));
    const offenders: string[] = [];
    for (const f of files) {
      const lines = readFileSync(f, "utf8").split("\n");
      lines.forEach((l, i) => {
        const nav = /(router\.(push|replace)|redirect\(|href=|href:|searchParams\.set|URLSearchParams)/.test(l);
        if (nav && /cpr/i.test(l) && !/maskCpr|cpr_invalid|duplicate_cpr/.test(l)) offenders.push(`${path.relative(ROOT, f)}:${i + 1}: ${l.trim()}`);
      });
    }
    expect(offenders).toEqual([]);
  });
  it("the dashboard search form is a Server Action (POST), never a GET form with a q field", () => {
    const src = readFileSync(path.join(ROOT, "app/admin/page.tsx"), "utf8");
    expect(src).toMatch(/<form action=\{searchDonors\}/);
    expect(src).not.toMatch(/method=["']get["']/i);
  });
  it("success redirect after signup carries only ref, slot, email status", () => {
    const src = readFileSync(path.join(ROOT, "components/public/SignupForm.tsx"), "utf8");
    const block = src.slice(src.indexOf("new URLSearchParams({"), src.indexOf("router.push"));
    expect(block).not.toMatch(/cpr|fullName|phone|dob/i);
  });
});

describe("+973 stripping, client and server schemas", () => {
  const base = {
    slotId: 1, fullName: "Ali Hasan", cpr: "990101123", dob: "1990-05-05", email: "",
    bloodType: "O+", recentDonation: false, onMedication: false, consent: true, token: "t",
  };
  const phone = (p: string, schema: typeof signupSchema | typeof signupClientSchema = signupSchema) => {
    const { token, ...noToken } = base;
    return schema.safeParse({ ...(schema === signupSchema ? { token } : {}), ...noToken, phone: p });
  };
  it.each(["+973 3333 4444", "+97333334444", "0097333334444", "97333334444", "+973-3333-4444", "33334444", "٣٣٣٣٤٤٤٤"])(
    "accepts %j and normalises to 33334444 (server and client schema)",
    (p) => {
      for (const s of [signupSchema, signupClientSchema]) {
        const r = phone(p, s);
        expect(r.success).toBe(true);
        if (r.success) expect(r.data.phone).toBe("33334444");
      }
    },
  );
  it.each(["+9733333444", "+97433334444", "973333344445", "3333444", "+973", "abcdefgh"])("refuses %j", (p) => {
    expect(phone(p).success).toBe(false);
  });
});

describe("M4 check-in notices never show queue #null", () => {
  const statuses = ["registered", "verified", "waiting", "screening", "donated", "deferred", "no_show"] as never[];
  const results: CheckInResult[] = [];
  for (const status of statuses)
    for (const queueNumber of [null, 7])
      for (const alreadyCheckedIn of [true, false]) results.push({ ok: true, queueNumber, alreadyCheckedIn, status });
  it("exhaustive: no combination prints null/undefined/NaN", () => {
    for (const r of results) {
      const n = checkInNotice("Ali", r);
      expect(n.text).not.toMatch(/null|undefined|NaN/);
    }
  });
  it("no_show checked in (fresh) is a success with its queue number", () => {
    const n = checkInNotice("Ali", { ok: true, queueNumber: 12, alreadyCheckedIn: false, status: "waiting" as never });
    expect(n).toEqual({ kind: "success", text: "Ali checked in, queue #12" });
  });
  it("deferred refusal is an error with a real explanation", () => {
    const n = checkInNotice("Ali", { ok: true, queueNumber: null, alreadyCheckedIn: true, status: "deferred" as never });
    expect(n.kind).toBe("error");
    expect(n.text).toMatch(/Deferred.*cannot be checked in/);
  });
  it("a database error is passed through as an error", () => {
    expect(checkInNotice("Ali", { ok: false, error: "boom" })).toEqual({ kind: "error", text: "boom" });
  });
});

describe("L4 pagination past 1000 rows on the dashboard and the print list", () => {
  function rows(n: number) {
    return Array.from({ length: n }, (_, i) => ({
      id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
      full_name: `Donor ${i}`, cpr: String(100000000 + i), phone: null, email: null, blood_type: "O+",
      slot_id: null, source: "self_signup", status: "registered", queue_number: null, flagged: false,
      flag_reasons: [], email_sent: false, created_at: new Date(1.7e12 + i * 1000).toISOString(), dob: null, notes: null,
    }));
  }
  function fake(donors: unknown[]) {
    const requests: number[] = [];
    return {
      requests,
      from: (t: string) => {
        const c: Record<string, unknown> = {};
        for (const op of ["select", "order", "eq"]) c[op] = () => c;
        c.range = async (from: number, to: number) => {
          requests.push(from);
          return { data: donors.slice(from, Math.min(to + 1, from + 1000)), error: null };
        };
        c.single = async () => ({ data: { name_ar: "a", name_en: "e", location_ar: "l", location_en: "l", event_date: "2026-10-16" }, error: null });
        c.then = (r: (v: unknown) => unknown) => r({ data: [], error: null });
        void t;
        return c;
      },
    };
  }
  const flat = (node: unknown, out: string[] = [], props: Record<string, unknown>[] = []) => {
    if (node == null || typeof node === "boolean") return { out, props };
    if (typeof node === "string" || typeof node === "number") { out.push(String(node)); return { out, props }; }
    if (Array.isArray(node)) { node.forEach((n) => flat(n, out, props)); return { out, props }; }
    const el = node as { props?: Record<string, unknown> };
    if (el.props) { props.push(el.props); for (const v of Object.values(el.props)) if (typeof v === "object") flat(v, out, props); }
    return { out, props };
  };
  it("dashboard counts all 2500 donors across 3 pages", async () => {
    const fk = fake(rows(2500));
    h.supabase = fk;
    const { default: Page } = await import("@/app/admin/page");
    const tree = await Page({ searchParams: Promise.resolve({}) });
    const { props } = flat(tree);
    expect(fk.requests).toEqual([0, 1000, 2000]);
    expect(props.some((p) => p.label === "Total" && p.value === 2500)).toBe(true);
  });
  it("print list includes all 2500 donors", async () => {
    const fk = fake(rows(2500));
    h.supabase = fk;
    const { default: Page } = await import("@/app/admin/print/page");
    const tree = await Page({ searchParams: Promise.resolve({}) });
    expect(fk.requests).toEqual([0, 1000, 2000]);
    expect(flat(tree).out.join("")).toContain("2500");
  });
  it("exactly 1000 rows still issues a second (empty) request, not a loss", async () => {
    const fk = fake(rows(1000));
    h.supabase = fk;
    const { default: Page } = await import("@/app/admin/page");
    const tree = await Page({ searchParams: Promise.resolve({}) });
    expect(fk.requests).toEqual([0, 1000]);
    expect(flat(tree).props.some((p) => p.label === "Total" && p.value === 1000)).toBe(true);
  });
});

describe("scripts/create-local-admin.mjs isLocalUrl guard", () => {
  it.each([
    "http://127.0.0.1:54321", "http://localhost:54321", "http://localhost", "https://127.0.0.1", "HTTP://LOCALHOST:54321",
    // WHATWG URL normalises these to 127.0.0.1, so they really are loopback
    "http://127.1", "http://2130706433", "http://0x7f.0.0.1",
  ])("allows %s", async (u) => {
    const { isLocalUrl } = await import("../../scripts/create-local-admin.mjs");
    expect(isLocalUrl(u)).toBe(true);
  });
  it.each([
    "https://abc.supabase.co", "http://127.0.0.1.evil.com", "http://localhost.evil.com", "http://evil.com/127.0.0.1",
    "http://127.0.0.1@evil.com", "http://localhost@evil.com", "http://evil.com#@localhost", "http://evil.com?x=localhost",
    "http://[::1]:54321", "http://[::ffff:127.0.0.1]", "http://0.0.0.0",
    "http://evil.com\\@localhost", "http://localhost.", "http://xlocalhost", "localhost", "127.0.0.1:54321", "", "javascript:localhost",
  ])("refuses %j", async (u) => {
    const { isLocalUrl } = await import("../../scripts/create-local-admin.mjs");
    expect(isLocalUrl(u)).toBe(false);
  });
});

describe("L1 / L2 runEmailRetry pool", () => {
  const deferred = () => { let res!: (v: "sent") => void; const p = new Promise<"sent">((r) => (res = r)); return { p, res }; };
  it("never runs more than 5 sends at once, honours the limit, sends each donor once", async () => {
    const { runEmailRetry } = await vi.importActual<typeof import("@/lib/email/dispatch")>("@/lib/email/dispatch");
    const ids = Array.from({ length: 30 }, (_, i) => `id${i}`);
    let active = 0, peak = 0;
    const seen: string[] = [];
    const r = await runEmailRetry(
      { listCandidates: async (n: number) => ids.slice(0, n), send: async (id: string) => { seen.push(id); active++; peak = Math.max(peak, active); await new Promise((x) => setTimeout(x, 5)); active--; return "sent" as const; } } as never,
      20,
    );
    expect(peak).toBe(5);
    expect(r.attempted).toBe(20);
    expect(new Set(seen).size).toBe(20);
    expect(r.stoppedForTime).toBe(false);
  });
  it("starts nothing after the soft deadline; in-flight sends finish", async () => {
    const { runEmailRetry } = await vi.importActual<typeof import("@/lib/email/dispatch")>("@/lib/email/dispatch");
    let t = 0;
    const gates = [deferred(), deferred()];
    const started: string[] = [];
    const run = runEmailRetry(
      { listCandidates: async () => ["a", "b", "c", "d", "e", "f"], send: async (id: string) => { started.push(id); const g = gates[started.length - 1]; return g ? g.p : ("sent" as const); } } as never,
      6,
      { concurrency: 2, deadline: 100, now: () => t },
    );
    await new Promise((x) => setTimeout(x, 10));
    expect(started).toEqual(["a", "b"]);
    t = 100; // deadline passes while a and b are in flight
    gates.forEach((g) => g.res("sent"));
    const r = await run;
    expect(started).toEqual(["a", "b"]);
    expect(r.attempted).toBe(2);
    expect(r.sent).toBe(2);
    expect(r.stoppedForTime).toBe(true);
  });
  it("a budget refusal (queued) stops further starts; limit 0 sends nothing", async () => {
    const { runEmailRetry } = await vi.importActual<typeof import("@/lib/email/dispatch")>("@/lib/email/dispatch");
    const send = vi.fn(async () => "queued" as const);
    const r = await runEmailRetry({ listCandidates: async () => ["a", "b", "c"], send } as never, 3, { concurrency: 1 });
    expect(send).toHaveBeenCalledTimes(1);
    expect(r.stoppedForBudget).toBe(true);
    const send0 = vi.fn();
    const r0 = await runEmailRetry({ listCandidates: async () => ["a"], send: send0 } as never, 0);
    expect(send0).not.toHaveBeenCalled();
    expect(r0.stoppedForBudget).toBe(true);
  });
});
