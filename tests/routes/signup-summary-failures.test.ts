import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  registerDonor: vi.fn(),
  reportAlert: vi.fn(),
  reportSubmission: vi.fn(),
  getSignupSummary: vi.fn(),
  afterImpl: vi.fn(),
}));

vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return { ...actual, after: (task: unknown) => m.afterImpl(task) };
});
vi.mock("@/lib/rate-limit", () => ({
  checkSignupRateLimit: vi.fn().mockResolvedValue(true),
  recordSignupAttempt: vi.fn().mockResolvedValue(true),
  clientIp: () => "1.2.3.4",
}));
vi.mock("@/lib/turnstile", () => ({ verifyTurnstile: vi.fn().mockResolvedValue(true) }));
vi.mock("@/lib/db/public", () => ({
  getEvent: vi.fn().mockResolvedValue({ event_date: "2026-10-16", public_registration_open: true }),
  registerDonor: m.registerDonor,
  findSubmission: vi.fn(),
}));
vi.mock("@/lib/alert", () => ({ reportAlert: m.reportAlert, reportSubmission: m.reportSubmission }));
vi.mock("@/lib/db/signup-summary", () => ({ getSignupSummary: m.getSignupSummary }));
vi.mock("@/lib/db/cpr-image", () => ({ attachCprImage: vi.fn().mockResolvedValue(true) }));
vi.mock("@/lib/email/dispatch", () => ({ sendDonorEmail: vi.fn().mockResolvedValue("sent") }));

import { POST } from "@/app/api/signup/route";
import { multipartRequest } from "../helpers/multipart";

// No email, so the summary is the only after() call.
const good = {
  slotId: 3,
  fullName: "Ali Hasan",
  cpr: "990101123",
  dob: "1990-05-05",
  phone: "33334444",
  bloodType: "O+",
  recentDonation: false,
  onMedication: false,
  consent: true,
  token: "tok",
};
const ID = "abcdef12-3456-4890-8bcd-ef1234567890";

beforeEach(() => {
  vi.clearAllMocks();
  m.registerDonor.mockResolvedValue({ ok: true, id: ID });
  m.getSignupSummary.mockResolvedValue({ status: "registered", total: 42 });
});

describe("signup when the Discord summary path misbehaves", () => {
  it("returns 200 and still sends a notice (without the summary) when after() throws", async () => {
    m.afterImpl.mockImplementation(() => {
      throw new Error("no request scope");
    });
    const res = await POST(multipartRequest(good));
    expect(res.status).toBe(200);
    expect(m.reportSubmission).toHaveBeenCalledTimes(1);
    const n = m.reportSubmission.mock.calls[0]![0] as Record<string, unknown>;
    expect(n.outcome).toBe("success");
    expect(n.total).toBeUndefined();
    expect(n.status).toBeUndefined();
  });
  it("returns 200 even when the summary read rejects", async () => {
    let task: unknown;
    m.afterImpl.mockImplementation((t: unknown) => {
      task = t;
    });
    m.getSignupSummary.mockRejectedValue(new Error("db down"));
    const res = await POST(multipartRequest(good));
    expect(res.status).toBe(200);
    // The deferred task runs after the response; whatever it does must not change the response.
    await Promise.resolve((task as () => Promise<void>)()).catch(() => {});
  });
  it("signup_error where is the static route, even when the request URL has a query string", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    m.registerDonor.mockRejectedValue(new Error("fetch failed"));
    const url = "http://x/api/signup?phone=33334444&cpr=990101123";
    const base = multipartRequest(good);
    await POST(new Request(url, { method: "POST", headers: base.headers, body: await base.arrayBuffer() }));
    const alert = m.reportAlert.mock.calls.map((c) => c[0] as { event: string; where?: string }).find((a) => a.event === "signup_error");
    expect(alert?.where).toBe("/api/signup");
    expect(JSON.stringify(alert?.where)).not.toMatch(/\?|33334444|990101123|Ali/);
  });
  it("sets total and status on the notice once the deferred task has run", async () => {
    let task: unknown;
    m.afterImpl.mockImplementation((t: unknown) => {
      task = t;
    });
    const res = await POST(multipartRequest(good));
    expect(res.status).toBe(200);
    expect(m.reportSubmission).not.toHaveBeenCalled();
    await (task as () => Promise<void>)();
    expect(m.reportSubmission.mock.calls[0]![0]).toMatchObject({ outcome: "success", status: "registered", total: 42 });
  });
});
