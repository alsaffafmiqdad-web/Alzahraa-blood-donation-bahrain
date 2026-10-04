import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  checkSignupRateLimit: vi.fn(),
  recordSignupAttempt: vi.fn(),
  verifyTurnstile: vi.fn(),
  getEvent: vi.fn(),
  registerDonor: vi.fn(),
  sendDonorEmail: vi.fn(),
}));
const h = vi.hoisted(() => ({ clientOpts: [] as { deadlineMs?: number }[] }));

vi.mock("@/lib/rate-limit", () => ({
  checkSignupRateLimit: m.checkSignupRateLimit,
  recordSignupAttempt: m.recordSignupAttempt,
  clientIp: () => "1.2.3.4",
}));
vi.mock("@/lib/turnstile", () => ({ verifyTurnstile: m.verifyTurnstile }));
vi.mock("@/lib/db/public", () => ({ getEvent: m.getEvent, registerDonor: m.registerDonor }));
vi.mock("@/lib/email/dispatch", () => ({ sendDonorEmail: m.sendDonorEmail }));
vi.mock("@/lib/supabase/admin", async (orig) => {
  const actual = await orig<typeof import("@/lib/supabase/admin")>();
  return {
    ...actual,
    createSupabaseAdminClient: (opts: { deadlineMs?: number } = {}) => {
      h.clientOpts.push(opts);
      return actual.createSupabaseAdminClient({ ...opts, deadlineMs: opts.deadlineMs ? 50 : undefined });
    },
  };
});

import { POST } from "@/app/api/signup/route";
import { CPR_IMAGE_CLEANUP_DEADLINE_MS, CPR_IMAGE_DEADLINE_MS } from "@/lib/db/cpr-image";
import { resetEnvCache } from "@/lib/env";
import { multipartRequest } from "../helpers/multipart";

const good = {
  slotId: 3, fullName: "Ali Hasan", cpr: "990101123", dob: "1990-05-05", phone: "33334444",
  email: "ali@example.com", bloodType: "O+", recentDonation: false, onMedication: false, consent: true, token: "tok",
};
const ID = "abcdef12-3456-4890-8bcd-ef1234567890";
const envBackup = { ...process.env };

const hangOn = (init?: RequestInit) =>
  new Promise<Response>((_, reject) => {
    const s = init?.signal;
    if (s?.aborted) return reject(s.reason);
    s?.addEventListener("abort", () => reject(s.reason), { once: true });
  });
const jsonRes = (body: string, status = 200) =>
  new Response(body, { status, headers: { "content-type": "application/json" } });

beforeEach(() => {
  vi.clearAllMocks();
  h.clientOpts.length = 0;
  vi.spyOn(console, "error").mockImplementation(() => {});
  Object.assign(process.env, {
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
    SUPABASE_SERVICE_ROLE_KEY: "svc",
    TURNSTILE_SECRET_KEY: "tsecret",
    RATE_LIMIT_SALT: "salt",
    CRON_SECRET: "c",
    RESEND_API_KEY: "re_dummy",
  });
  resetEnvCache();
  m.checkSignupRateLimit.mockResolvedValue(true);
  m.recordSignupAttempt.mockResolvedValue(true);
  m.verifyTurnstile.mockResolvedValue(true);
  m.getEvent.mockResolvedValue({ event_date: "2026-10-16", public_registration_open: true });
  m.registerDonor.mockResolvedValue({ ok: true, id: ID });
  m.sendDonorEmail.mockResolvedValue("sent");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  process.env = { ...envBackup };
  resetEnvCache();
});

describe("signup when Storage is slow", () => {
  it("still returns 200 and emails when the upload hangs", async () => {
    const fetchMock = vi.fn((_u: unknown, init?: RequestInit) => hangOn(init));
    vi.stubGlobal("fetch", fetchMock);
    const res = await POST(multipartRequest(good));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, ref: "ABCDEF12" });
    expect(m.sendDonorEmail).toHaveBeenCalledWith(ID);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining(`cpr image error donor=${ID}`));
    expect(h.clientOpts[0]).toEqual({ deadlineMs: CPR_IMAGE_DEADLINE_MS });
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes("/rest/v1/donors"))).toBe(false);
  });

  it("cleans up the stored object on a fresh budget when the row update hangs", async () => {
    const calls: { url: string; method: string }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((u: unknown, init?: RequestInit) => {
        const url = String(u);
        const method = (init?.method ?? "GET").toUpperCase();
        calls.push({ url, method });
        if (url.includes("/rest/v1/donors")) return hangOn(init);
        if (method === "POST" && url.includes("/storage/v1/object/cpr-images/")) {
          return Promise.resolve(jsonRes(JSON.stringify({ Id: "x", Key: `cpr-images/${ID}/cpr.jpg` })));
        }
        if (method === "DELETE" && url.includes("/storage/v1/object/cpr-images")) {
          return Promise.resolve(jsonRes("[]"));
        }
        return Promise.reject(new Error(`unexpected ${method} ${url}`));
      }),
    );
    const res = await POST(multipartRequest(good));
    expect(res.status).toBe(200);
    expect(calls.some((c) => c.method === "DELETE" && c.url.includes("/storage/v1/object/cpr-images"))).toBe(true);
    expect(h.clientOpts).toEqual([{ deadlineMs: CPR_IMAGE_DEADLINE_MS }, { deadlineMs: CPR_IMAGE_CLEANUP_DEADLINE_MS }]);
  });
});
