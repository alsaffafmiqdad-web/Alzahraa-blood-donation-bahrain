import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Cron route with the real lib/db/email, lib/email/dispatch and route, over an in-memory fake of the
 * Supabase admin client that models donors, email_sends and the claim/finish functions faithfully
 * (24h rolling budget, attempts counter).
 */
type Donor = { id: string; email: string | null; email_sent: boolean; email_attempts: number; created_at: string; slot_id: number | null; full_name: string; blood_type: string };
const st = vi.hoisted(() => ({
  donors: [] as Donor[],
  sends: [] as { id: number; donor_id: string; status: string; at: number }[],
  now: Date.parse("2026-10-10T06:00:00Z"),
  resend: vi.fn(),
  maintenance: vi.fn(),
  lastQuery: null as null | { limit?: number; filters: string[] },
}));

vi.mock("@/lib/pdf/render", () => ({ renderDonorCard: async () => Buffer.from("pdf") }));
vi.mock("resend", () => ({ Resend: class { emails = { send: st.resend }; } }));
vi.mock("@/lib/db/maintenance", () => ({ ping: async () => {}, dailyMaintenance: st.maintenance }));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    rpc: async (name: string, args: Record<string, unknown>) => {
      if (name === "claim_email_send") {
        const used = st.sends.filter((s) => s.status !== "failed" && s.at > st.now - 24 * 3600_000).length;
        if (used >= (args.p_budget as number)) return { data: null, error: null };
        const id = st.sends.length + 1;
        st.sends.push({ id, donor_id: args.p_donor_id as string, status: "claimed", at: st.now });
        return { data: id, error: null };
      }
      if (name === "email_budget_remaining") {
        const used = st.sends.filter((s) => s.status !== "failed" && s.at > st.now - 24 * 3600_000).length;
        return { data: Math.max((args.p_budget as number) - used, 0), error: null };
      }
      if (name === "finish_email_send") {
        const s = st.sends.find((x) => x.id === args.p_claim_id)!;
        s.status = args.p_success ? "sent" : "failed";
        const d = st.donors.find((x) => x.id === s.donor_id)!;
        d.email_sent = (args.p_success as boolean) || d.email_sent;
        d.email_attempts += 1;
        return { data: null, error: null };
      }
      throw new Error("unexpected rpc " + name);
    },
    from: (table: string) => {
      const filters: ((d: Donor) => boolean)[] = [];
      const names: string[] = [];
      let limit = Infinity;
      const c: Record<string, unknown> = {};
      c.select = () => c;
      c.not = (col: string) => (filters.push((d) => (d as never)[col] !== null), names.push(`not ${col} null`), c);
      c.eq = (col: string, v: unknown) => (filters.push((d) => (d as never)[col] === v), names.push(`eq ${col}`), c);
      c.lt = (col: string, v: number) => (filters.push((d) => (d as never)[col] < v), names.push(`lt ${col} ${v}`), c);
      c.order = () => c;
      c.limit = (n: number) => ((limit = n), c);
      c.maybeSingle = async () => {
        if (table === "slots") return { data: { starts_at: "09:00:00" }, error: null };
        const d = st.donors.find((x) => filters.every((f) => f(x)));
        return { data: d ?? null, error: null };
      };
      c.single = async () => ({
        data: { name_ar: "a", name_en: "b", location_ar: "", location_en: "", event_date: "2026-10-16", public_registration_open: true },
        error: null,
      });
      c.then = (res: (v: unknown) => unknown) => {
        st.lastQuery = { limit, filters: names };
        const rows = st.donors
          .filter((d) => filters.every((f) => f(d)))
          .sort((a, b) => a.created_at.localeCompare(b.created_at))
          .slice(0, limit);
        return res({ data: rows, error: null });
      };
      return c;
    },
  }),
}));

import { GET } from "@/app/api/cron/daily/route";
import { resetEnvCache } from "@/lib/env";

const call = (auth?: string) => GET(new Request("http://x/api/cron/daily", { headers: auth ? { authorization: auth } : {} }));
const mk = (n: number, over: Partial<Donor> = {}): Donor[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `00000000-0000-4000-8000-${String(i + 1 + (over.email_attempts ?? 0) * 1000).padStart(12, "0")}`,
    email: `d${i}@example.com`, email_sent: false, email_attempts: 0,
    created_at: new Date(Date.UTC(2026, 9, 1, 0, i)).toISOString(), slot_id: 1, full_name: "N" + i, blood_type: "O+", ...over,
  }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  st.donors = [];
  st.sends = [];
  st.resend.mockResolvedValue({ data: { id: "x" }, error: null });
  Object.assign(process.env, {
    CRON_SECRET: "cron-secret", RESEND_API_KEY: "re_x", RESEND_FROM_EMAIL: "f@example.com", EMAIL_DAILY_BUDGET: "95",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:1", NEXT_PUBLIC_SUPABASE_ANON_KEY: "a", SUPABASE_SERVICE_ROLE_KEY: "s",
    TURNSTILE_SECRET_KEY: "t", RATE_LIMIT_SALT: "s",
  });
  resetEnvCache();
});

describe("cron auth", () => {
  it("rejects missing, wrong, differently-cased and prefix-only secrets and does no work", async () => {
    st.donors = mk(3);
    for (const h of [undefined, "", "Bearer", "Bearer cron-secre", "bearer cron-secret", "cron-secret", "Bearer cron-secret-extra", "Bearer CRON-SECRET"]) {
      expect((await call(h)).status, String(h)).toBe(401);
    }
    expect(st.resend).not.toHaveBeenCalled();
    expect(st.maintenance).not.toHaveBeenCalled();
  });
  it("rejects a secret passed by query string", async () => {
    const res = await GET(new Request("http://x/api/cron/daily?secret=cron-secret"));
    expect(res.status).toBe(401);
  });
  it("rejects everything when CRON_SECRET is not set, even an empty bearer", async () => {
    delete process.env.CRON_SECRET;
    expect((await call("Bearer ")).status).toBe(401);
    expect((await call("Bearer undefined")).status).toBe(401);
  });
});

describe("cron email retry limits", () => {
  it("per-run cap is what is left of the budget: 120 pending, nothing used -> exactly 95 sent, oldest first", async () => {
    st.donors = mk(120);
    process.env.EMAIL_DAILY_BUDGET = "95";
    const res = await call("Bearer cron-secret");
    const body = await res.json();
    expect(body.retry).toEqual({ attempted: 95, sent: 95, failed: 0, stoppedForBudget: false, stoppedForTime: false });
    expect(st.resend).toHaveBeenCalledTimes(95);
    expect(st.lastQuery?.limit).toBe(95);
    expect(st.donors.slice(0, 95).every((d) => d.email_sent)).toBe(true);
    expect(st.donors.slice(95).some((d) => d.email_sent)).toBe(false);
  });
  it("launch-day backlog: 30 used during the day -> the cron drains the remaining 65 in one run", async () => {
    st.donors = mk(100);
    for (let i = 0; i < 30; i++) st.sends.push({ id: i + 1, donor_id: "x", status: "sent", at: st.now - 3600_000 });
    const body = await (await call("Bearer cron-secret")).json();
    expect(st.lastQuery?.limit).toBe(65);
    expect(body.retry.sent).toBe(65);
    expect(st.sends.filter((s) => s.status !== "failed").length).toBe(95);
  });
  it("sends concurrently (several Resend calls in flight at once, never more than 5)", async () => {
    st.donors = mk(20);
    let inFlight = 0;
    let peak = 0;
    st.resend.mockImplementation(async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight -= 1;
      return { data: { id: "x" }, error: null };
    });
    const body = await (await call("Bearer cron-secret")).json();
    expect(body.retry.sent).toBe(20);
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(5);
  });
  it("stops early for time and leaves the rest for the next run", async () => {
    st.donors = mk(50);
    const realNow = Date.now;
    let t = realNow();
    vi.spyOn(Date, "now").mockImplementation(() => t);
    st.resend.mockImplementation(async () => {
      t += 60_000; // each send "takes" a minute: the 240 s soft deadline passes after a few sends
      return { data: { id: "x" }, error: null };
    });
    const body = await (await call("Bearer cron-secret")).json();
    vi.restoreAllMocks();
    expect(body.retry.stoppedForTime).toBe(true);
    expect(body.retry.sent).toBeLessThan(50);
    expect(body.retry.sent).toBeGreaterThan(0);
    expect(st.donors.filter((d) => !d.email_sent).length).toBeGreaterThan(0);
  });
  it("budget: 90 already used in the last 24h -> only 5 more sent, then stops", async () => {
    st.donors = mk(30);
    for (let i = 0; i < 90; i++) st.sends.push({ id: 1000 + i, donor_id: "x", status: "sent", at: st.now - 3600_000 });
    st.sends.forEach((s, i) => (s.id = i + 1));
    const body = await (await call("Bearer cron-secret")).json();
    expect(body.retry.sent).toBe(5);
    expect(st.lastQuery?.limit).toBe(5);
    expect(st.resend).toHaveBeenCalledTimes(5);
    expect(st.sends.filter((s) => s.status !== "failed").length).toBe(95);
  });
  it("budget: sends older than 24h do not count", async () => {
    st.donors = mk(5);
    for (let i = 0; i < 95; i++) st.sends.push({ id: i + 1, donor_id: "x", status: "sent", at: st.now - 25 * 3600_000 });
    const body = await (await call("Bearer cron-secret")).json();
    expect(body.retry.sent).toBe(5);
  });
  it("budget fully used: nothing is sent and Resend is never called", async () => {
    st.donors = mk(5);
    for (let i = 0; i < 95; i++) st.sends.push({ id: i + 1, donor_id: "x", status: "claimed", at: st.now - 60_000 });
    const body = await (await call("Bearer cron-secret")).json();
    expect(body.retry).toEqual({ attempted: 0, sent: 0, failed: 0, stoppedForBudget: true, stoppedForTime: false });
    expect(st.resend).not.toHaveBeenCalled();
  });
  it("failed sends do not consume budget but count as an attempt on the donor", async () => {
    st.donors = mk(2);
    st.resend.mockResolvedValue({ data: null, error: { message: "nope" } });
    const body = await (await call("Bearer cron-secret")).json();
    expect(body.retry).toEqual({ attempted: 2, sent: 0, failed: 2, stoppedForBudget: false, stoppedForTime: false });
    expect(st.donors.map((d) => d.email_attempts)).toEqual([1, 1]);
    expect(st.sends.every((s) => s.status === "failed")).toBe(true);
  });
  it("max attempts: donors at 5 attempts are skipped, at 4 are retried, sent ones and no-email ones skipped", async () => {
    const at5 = mk(2, { email_attempts: 5 });
    const at4 = mk(2, { email_attempts: 4 });
    const sent = mk(1, { email_sent: true }).map((d) => ({ ...d, id: "99999999-0000-4000-8000-000000000001" }));
    const noEmail = mk(1, { email: null }).map((d) => ({ ...d, id: "99999999-0000-4000-8000-000000000002" }));
    st.donors = [...at5, ...at4, ...sent, ...noEmail];
    const body = await (await call("Bearer cron-secret")).json();
    expect(body.retry.attempted).toBe(2);
    expect(at5.every((d) => d.email_attempts === 5 && !d.email_sent)).toBe(true);
    expect(at4.every((d) => d.email_sent)).toBe(true);
    expect(sent[0]!.email_attempts).toBe(0);
    expect(noEmail[0]!.email_attempts).toBe(0);
  });
  it("a donor stops being retried after it hits 5 failed attempts across runs", async () => {
    st.donors = mk(1);
    st.resend.mockResolvedValue({ data: null, error: { message: "nope" } });
    for (let run = 1; run <= 7; run++) await call("Bearer cron-secret");
    expect(st.donors[0]!.email_attempts).toBe(5);
    expect(st.resend).toHaveBeenCalledTimes(5);
  });
  it("uses EMAIL_DAILY_BUDGET from env", async () => {
    st.donors = mk(10);
    process.env.EMAIL_DAILY_BUDGET = "3";
    const body = await (await call("Bearer cron-secret")).json();
    expect(body.retry.sent).toBe(3);
    expect(st.lastQuery?.limit).toBe(3);
  });
  it("retry query filters: email not null, not sent, attempts < 5", async () => {
    st.donors = mk(1);
    await call("Bearer cron-secret");
    expect(st.lastQuery?.filters).toEqual(["not email null", "eq email_sent", "lt email_attempts 5"]);
  });
});
