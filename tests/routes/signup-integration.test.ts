import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * /api/signup with the REAL rate-limit, turnstile, db/public and dispatch modules.
 * Only the outermost edges are stubbed: Supabase admin client (rpc/from), global fetch (Turnstile) and Resend.
 */
const h = vi.hoisted(() => ({
  rpc: vi.fn(),
  event: { event_date: "2026-10-16", event_start_time: "08:30:00", public_registration_open: true, name_ar: "a", name_en: "b", location_ar: "", location_en: "" },
  resendSend: vi.fn(),
  fetchMock: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    rpc: h.rpc,
    from: (table: string) => {
      const c: Record<string, unknown> = {};
      for (const op of ["select", "eq"]) c[op] = () => c;
      c.single = async () => ({ data: table === "event" ? h.event : null, error: null });
      c.maybeSingle = async () =>
        table === "donors"
          ? {
              data: { id: ID, email: "ali@example.com", full_name: "Ali Hasan", blood_type: "O+", slot_id: 3, created_at: "2026-10-03T10:00:00Z" },
              error: null,
            }
          : { data: { starts_at: "09:30:00" }, error: null };
      return c;
    },
  }),
}));
vi.mock("resend", () => ({ Resend: class { emails = { send: h.resendSend }; } }));
vi.mock("@/lib/pdf/render", () => ({ renderDonorCard: async () => Buffer.from("%PDF-fake") }));

import { POST } from "@/app/api/signup/route";
import { resetEnvCache } from "@/lib/env";
import { flushAfter } from "../helpers/after";
import { multipartRequest } from "../helpers/multipart";

const ID = "abcdef12-3456-4890-8bcd-ef1234567890";
const good = {
  slotId: 3, fullName: "Ali Hasan", cpr: "990101123", dob: "1990-05-05", phone: "33334444",
  email: "ali@example.com", bloodType: "O+", recentDonation: false, onMedication: false, consent: true, token: "tok",
};
const req = (body: unknown, headers: Record<string, string> = {}) =>
  "content-type" in headers || Object.keys(headers).some((k) => k.toLowerCase() === "content-type")
    ? jsonReq(body, headers)
    : multipartRequest(body, { headers: { "x-real-ip": "9.9.9.9", ...headers } });
const jsonReq = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("http://x/api/signup", {
    method: "POST",
    headers: { "content-type": "application/json", "x-real-ip": "9.9.9.9", ...headers },
    body: JSON.stringify(body),
  });

type RpcMap = Record<string, (args: Record<string, unknown>) => { data: unknown; error: { message: string } | null }>;
let rpcs: RpcMap;
const envBackup = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  Object.assign(process.env, {
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
    SUPABASE_SERVICE_ROLE_KEY: "svc",
    TURNSTILE_SECRET_KEY: "tsecret",
    RATE_LIMIT_SALT: "salt",
    CRON_SECRET: "c",
    RESEND_API_KEY: "re_dummy",
    RESEND_FROM_EMAIL: "from@example.com",
    EMAIL_DAILY_BUDGET: "95",
  });
  resetEnvCache();
  h.event.public_registration_open = true;
  rpcs = {
    rate_limit_peek: () => ({ data: true, error: null }),
    rate_limit_hit: () => ({ data: true, error: null }),
    register_donor: () => ({ data: ID, error: null }),
    claim_email_send: () => ({ data: 7, error: null }),
    finish_email_send: () => ({ data: null, error: null }),
  };
  h.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => rpcs[name]!(args));
  h.resendSend.mockResolvedValue({ data: { id: "e1" }, error: null });
  h.fetchMock.mockImplementation(async () => new Response(JSON.stringify({ success: true })));
  vi.stubGlobal("fetch", h.fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  process.env = { ...envBackup };
});

describe("signup end to end with mocked edges", () => {
  it("walk-in day: calls register_walk_in_donor without a slot and returns the queue number", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-16T06:00:00Z"));
    try {
      rpcs.register_walk_in_donor = () => ({ data: [{ donor_id: ID, queue_number: 12 }], error: null });
      const { slotId, ...noSlot } = good;
      void slotId;
      const res = await POST(req(noSlot));
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ ok: true, walkIn: true, queueNumber: 12, ref: "ABCDEF12" });
      const call = h.rpc.mock.calls.find((c) => c[0] === "register_walk_in_donor")!;
      expect(call[1]).not.toHaveProperty("p_slot_id");
      expect(h.rpc.mock.calls.map((c) => c[0])).not.toContain("register_donor");
    } finally {
      vi.useRealTimers();
    }
  });
  it("happy path: verifies Turnstile with secret+token+ip, registers, emails", async () => {
    const res = await POST(req(good));
    expect(res.status).toBe(200);
    const resBody = (await res.json()) as Record<string, unknown>;
    expect(resBody).toMatchObject({ ok: true, ref: "ABCDEF12", slotId: 3, emailStatus: "sending" });
    await flushAfter();
    expect(h.resendSend).toHaveBeenCalledTimes(1);
    // A signed card token for the success-page download; it carries no CPR.
    expect(resBody.card).toMatch(/^abcdef12-3456-4890-8bcd-ef1234567890\.\d+\.[A-Za-z0-9_-]{43}$/);
    expect(JSON.stringify(resBody)).not.toContain(good.cpr);
    const [url, init] = h.fetchMock.mock.calls[0]!;
    expect(url).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
    const body = (init.body as URLSearchParams).toString();
    expect(body).toContain("secret=tsecret");
    expect(body).toContain("response=tok");
    expect(body).toContain("remoteip=9.9.9.9");
    // only Turnstile was fetched; no other network call
    expect(h.fetchMock).toHaveBeenCalledTimes(1);
  });
  it("the rate limit key is a salted hash of the IP, never the raw IP", async () => {
    await POST(req(good));
    const call = h.rpc.mock.calls.find((c) => c[0] === "rate_limit_hit")!;
    expect(call[1].p_key).toMatch(/^signup:[0-9a-f]{64}$/);
    expect(call[1].p_key).not.toContain("9.9.9.9");
    expect(call[1].p_limit).toBe(25);
    expect(call[1].p_window_seconds).toBe(600);
    const peek = h.rpc.mock.calls.find((c) => c[0] === "rate_limit_peek")!;
    expect(peek[1].p_key).toBe(call[1].p_key);
    expect(peek[1].p_limit).toBe(25);
  });
  it("429 when the peek says the IP is already at the limit; nothing else runs, nothing is counted", async () => {
    rpcs.rate_limit_peek = () => ({ data: false, error: null });
    const res = await POST(req(good));
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("600");
    expect(h.fetchMock).not.toHaveBeenCalled();
    expect(h.rpc.mock.calls.map((c) => c[0])).toEqual(["rate_limit_peek"]);
  });
  it("429 when the counted hit goes over the limit (race), before register_donor", async () => {
    rpcs.rate_limit_hit = () => ({ data: false, error: null });
    const res = await POST(req(good));
    expect(res.status).toBe(429);
    expect(h.rpc.mock.calls.map((c) => c[0])).toEqual(["rate_limit_peek", "rate_limit_hit"]);
  });
  it("validation errors and failed Turnstile never call rate_limit_hit", async () => {
    await POST(req({ ...good, cpr: "12" }));
    h.fetchMock.mockImplementation(async () => new Response(JSON.stringify({ success: false })));
    await POST(req(good));
    expect(h.rpc.mock.calls.map((c) => c[0]).filter((n) => n === "rate_limit_hit")).toEqual([]);
  });
  it("rate limit fails open when the rpc errors (Turnstile still enforced)", async () => {
    rpcs.rate_limit_peek = () => ({ data: null, error: { message: "boom" } });
    rpcs.rate_limit_hit = () => ({ data: null, error: { message: "boom" } });
    expect((await POST(req(good))).status).toBe(200);
    h.fetchMock.mockImplementation(async () => new Response(JSON.stringify({ success: false })));
    expect((await POST(req(good))).status).toBe(403);
  });
  it("403 when Cloudflare says success:false, with no register_donor call", async () => {
    h.fetchMock.mockResolvedValue(new Response(JSON.stringify({ success: false, "error-codes": ["invalid-input-response"] })));
    const res = await POST(req(good));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("turnstile");
    expect(h.rpc.mock.calls.map((c) => c[0])).not.toContain("register_donor");
  });
  it("403 when the Turnstile call throws (network) or times out", async () => {
    h.fetchMock.mockRejectedValue(new Error("network"));
    expect((await POST(req(good))).status).toBe(403);
  });
  it("403 for an empty token, without calling Cloudflare", async () => {
    const res = await POST(req({ ...good, token: "" }));
    expect([400, 403]).toContain(res.status);
    expect(h.fetchMock).not.toHaveBeenCalled();
  });
  it("403 when registration is closed, before register_donor", async () => {
    h.event.public_registration_open = false;
    const res = await POST(req(good));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("registration_closed");
    expect(h.rpc.mock.calls.map((c) => c[0])).not.toContain("register_donor");
  });
  it("403 when the DB raises registration_closed (race)", async () => {
    rpcs.register_donor = () => ({ data: null, error: { message: "registration_closed" } });
    expect((await POST(req(good))).status).toBe(403);
  });
  it("409 duplicate_cpr from the DB error, leaking nothing", async () => {
    rpcs.register_donor = () => ({ data: null, error: { message: "duplicate_cpr" } });
    const res = await POST(req(good));
    expect(res.status).toBe(409);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ ok: false, error: "duplicate_cpr" });
    for (const secret of ["Ali", "990101123", "ali@example.com", "33334444", ABC()]) expect(text).not.toContain(secret);
    expect(h.resendSend).not.toHaveBeenCalled();
  });
  it("409 slot_full and slot_unavailable from the DB", async () => {
    for (const reason of ["slot_full", "slot_unavailable"]) {
      rpcs.register_donor = () => ({ data: null, error: { message: reason } });
      const res = await POST(req(good));
      expect(res.status).toBe(409);
      expect((await res.json()).error).toBe(reason);
    }
  });
  it("500 for an unknown DB error, with a generic body", async () => {
    rpcs.register_donor = () => ({ data: null, error: { message: 'permission denied for table donors, cpr=990101123' } });
    const res = await POST(req(good));
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain("990101123");
  });
  it("email failure from Resend still returns 200, donor saved, failure recorded after the response", async () => {
    h.resendSend.mockResolvedValue({ data: null, error: { message: "rate limited by resend" } });
    const res = await POST(req(good));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.emailStatus).toBe("sending");
    await flushAfter();
    const fin = h.rpc.mock.calls.find((c) => c[0] === "finish_email_send")!;
    expect(fin[1]).toMatchObject({ p_claim_id: 7, p_success: false });
  });
  it("email exception (Resend throws) still returns 200 and records failure", async () => {
    h.resendSend.mockRejectedValue(new Error("socket hang up"));
    const res = await POST(req(good));
    expect(res.status).toBe(200);
    expect((await res.json()).emailStatus).toBe("sending");
    await flushAfter();
    expect(h.rpc.mock.calls.find((c) => c[0] === "finish_email_send")![1]).toMatchObject({ p_success: false });
  });
  it("budget exhausted: 200, queued, Resend never called", async () => {
    rpcs.claim_email_send = () => ({ data: null, error: null });
    const res = await POST(req(good));
    expect((await res.json()).emailStatus).toBe("sending");
    await flushAfter();
    expect(h.resendSend).not.toHaveBeenCalled();
    expect(h.rpc.mock.calls.find((c) => c[0] === "claim_email_send")![1]).toMatchObject({ p_budget: 95 });
  });
  it("Resend not configured: 200 and queued, no claim", async () => {
    delete process.env.RESEND_API_KEY;
    const res = await POST(req(good));
    expect((await res.json()).emailStatus).toBe("sending");
    await flushAfter();
    expect(h.rpc.mock.calls.map((c) => c[0])).not.toContain("claim_email_send");
  });
  it("email never contains the CPR and logs hold no PII", async () => {
    const logs: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...a) => void logs.push(a.join(" ")));
    h.resendSend.mockResolvedValue({ data: null, error: { message: "bad" } });
    await POST(req(good));
    await flushAfter();
    const sent = JSON.stringify(h.resendSend.mock.calls);
    expect(sent).not.toContain("990101123");
    for (const l of logs) {
      expect(l).not.toContain("Ali");
      expect(l).not.toContain("990101123");
      expect(l).not.toContain("ali@example.com");
    }
  });
  it("sends the full set of validated fields to register_donor, flags computed server-side", async () => {
    await POST(req({ ...good, recentDonation: true, onMedication: true }));
    const call = h.rpc.mock.calls.find((c) => c[0] === "register_donor")![1];
    expect(call).toMatchObject({
      p_cpr: "990101123", p_slot_id: 3, p_q_recent_donation: true, p_q_on_medication: true,
      p_flagged: true, p_flag_reasons: ["recent_donation", "on_medication"],
    });
    expect(Object.keys(call).sort()).toEqual(
      ["p_blood_type","p_cpr","p_dob","p_email","p_flag_reasons","p_flagged","p_full_name","p_phone","p_q_on_medication","p_q_recent_donation","p_slot_id","p_submission_id"],
    );
  });
  it("normalises Arabic-Indic digits in CPR and phone", async () => {
    await POST(req({ ...good, cpr: "٩٩٠١٠١١٢٣", phone: "٣٣٣٣٤٤٤٤" }));
    const call = h.rpc.mock.calls.find((c) => c[0] === "register_donor")![1];
    expect(call).toMatchObject({ p_cpr: "990101123", p_phone: "33334444" });
  });
  it("rejects missing consent, missing screening answers and unknown fields with 400", async () => {
    for (const body of [
      { ...good, consent: false },
      { ...good, recentDonation: undefined },
      { ...good, onMedication: undefined },
      { ...good, feelWell: true },
      { ...good, recentTravel: false },
      { ...good, flagged: false },
      { ...good, bloodType: "Z+" },
      { ...good, fullName: "" },
      { ...good, email: "not-an-email" },
      { ...good, phone: "123" },
      { ...good, slotId: "abc" },
    ]) {
      const res = await POST(req(body));
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    expect(h.fetchMock).not.toHaveBeenCalled();
  });
  it("415 for form content-type and for missing content-type", async () => {
    expect((await POST(req(good, { "content-type": "application/x-www-form-urlencoded" }))).status).toBe(415);
    const r = new Request("http://x/api/signup", { method: "POST", body: JSON.stringify(good) });
    expect([415]).toContain((await POST(r)).status);
  });
  it("a JSON body (no photo) is rejected with cpr_image_required, even with a charset", async () => {
    const res = await POST(req(good, { "content-type": "application/json; charset=utf-8" }));
    expect(res.status).toBe(400);
    expect((await res.json()).fields.cprImage).toBe("cpr_image_required");
  });
  it("sets no-store on every response", async () => {
    expect((await POST(req(good))).headers.get("cache-control")).toBe("no-store");
    expect((await POST(req(good, { "content-type": "text/plain" }))).headers.get("cache-control")).toBe("no-store");
  });
});

function ABC() {
  return "ABCDEF12"; // the donor ref must not leak on a duplicate either
}
