import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  checkSignupRateLimit: vi.fn(),
  recordSignupAttempt: vi.fn(),
  verifyTurnstile: vi.fn(),
  getEvent: vi.fn(),
  registerDonor: vi.fn(),
  sendDonorEmail: vi.fn(),
}));

vi.mock("@/lib/rate-limit", () => ({
  checkSignupRateLimit: m.checkSignupRateLimit,
  recordSignupAttempt: m.recordSignupAttempt,
  clientIp: () => "1.2.3.4",
}));
vi.mock("@/lib/turnstile", () => ({ verifyTurnstile: m.verifyTurnstile }));
vi.mock("@/lib/db/public", () => ({ getEvent: m.getEvent, registerDonor: m.registerDonor }));
vi.mock("@/lib/email/dispatch", () => ({ sendDonorEmail: m.sendDonorEmail }));

import { POST } from "@/app/api/signup/route";

const good = {
  slotId: 3,
  fullName: "Ali Hasan",
  cpr: "990101123",
  dob: "1990-05-05",
  phone: "33334444",
  email: "ali@example.com",
  bloodType: "O+",
  recentDonation: false,
  onMedication: false,
  consent: true,
  token: "tok",
};
const ID = "abcdef12-3456-4890-8bcd-ef1234567890";

function req(body: unknown, headers: Record<string, string> = { "content-type": "application/json" }) {
  return new Request("http://x/api/signup", {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  m.checkSignupRateLimit.mockResolvedValue(true);
  m.recordSignupAttempt.mockResolvedValue(true);
  m.verifyTurnstile.mockResolvedValue(true);
  m.getEvent.mockResolvedValue({ event_date: "2026-10-16", public_registration_open: true });
  m.registerDonor.mockResolvedValue({ ok: true, id: ID });
  m.sendDonorEmail.mockResolvedValue("sent");
});

describe("POST /api/signup", () => {
  it("429 when rate limited, before Turnstile", async () => {
    m.checkSignupRateLimit.mockResolvedValue(false);
    const res = await POST(req(good));
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("600");
    expect(m.verifyTurnstile).not.toHaveBeenCalled();
  });
  it("429 when the counted attempt pushes the IP over the limit, after Turnstile and before any write", async () => {
    m.recordSignupAttempt.mockResolvedValue(false);
    const res = await POST(req(good));
    expect(res.status).toBe(429);
    expect(m.verifyTurnstile).toHaveBeenCalled();
    expect(m.registerDonor).not.toHaveBeenCalled();
  });
  it("only requests that pass Zod and Turnstile count against the quota", async () => {
    await POST(req({ ...good, cpr: "123" })); // Zod failure
    await POST(req("{nope")); // bad JSON
    await POST(req(good, { "content-type": "text/plain" })); // wrong type
    m.verifyTurnstile.mockResolvedValue(false);
    await POST(req(good)); // Turnstile failure
    expect(m.recordSignupAttempt).not.toHaveBeenCalled();
    m.verifyTurnstile.mockResolvedValue(true);
    await POST(req(good));
    expect(m.recordSignupAttempt).toHaveBeenCalledTimes(1);
    expect(m.recordSignupAttempt).toHaveBeenCalledWith("1.2.3.4");
  });
  it("413 on an oversize body", async () => {
    const res = await POST(req({ ...good, fullName: "a".repeat(11_000) }));
    expect(res.status).toBe(413);
  });
  it("400 on bad JSON", async () => {
    expect((await POST(req("{nope"))).status).toBe(400);
  });
  it("415 on the wrong content type", async () => {
    expect((await POST(req(good, { "content-type": "text/plain" }))).status).toBe(415);
  });
  it("400 with field codes on a Zod failure", async () => {
    const res = await POST(req({ ...good, cpr: "123" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("validation");
    expect(body.fields.cpr).toBe("cpr_invalid");
    expect(m.verifyTurnstile).not.toHaveBeenCalled();
  });
  it("403 when Turnstile fails, with no register", async () => {
    m.verifyTurnstile.mockResolvedValue(false);
    const res = await POST(req(good));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("turnstile");
    expect(m.registerDonor).not.toHaveBeenCalled();
  });
  it("403 when registration is closed", async () => {
    m.getEvent.mockResolvedValue({ event_date: "2026-10-16", public_registration_open: false });
    const res = await POST(req(good));
    expect(res.status).toBe(403);
    expect(m.registerDonor).not.toHaveBeenCalled();
  });
  it("409 duplicate_cpr, without donor data", async () => {
    m.registerDonor.mockResolvedValue({ ok: false, reason: "duplicate_cpr" });
    const res = await POST(req(good));
    expect(res.status).toBe(409);
    const text = JSON.stringify(await res.json());
    expect(text).toContain("duplicate_cpr");
    expect(text).not.toContain("Ali");
    expect(text).not.toContain("990101123");
  });
  it("409 slot_full and slot_unavailable", async () => {
    m.registerDonor.mockResolvedValue({ ok: false, reason: "slot_full" });
    expect((await POST(req(good))).status).toBe(409);
    m.registerDonor.mockResolvedValue({ ok: false, reason: "slot_unavailable" });
    expect((await POST(req(good))).status).toBe(409);
  });
  it("200 with email sent", async () => {
    const res = await POST(req(good));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, ref: "ABCDEF12", slotId: 3, emailStatus: "sent" });
    expect(m.sendDonorEmail).toHaveBeenCalledWith(ID);
  });
  it("reports a failed email as queued", async () => {
    m.sendDonorEmail.mockResolvedValue("failed");
    const body = await (await POST(req(good))).json();
    expect(body.emailStatus).toBe("queued");
  });
  it("sends no email when there is no address", async () => {
    const { email, ...rest } = good;
    void email;
    const body = await (await POST(req(rest))).json();
    expect(body.emailStatus).toBe("none");
    expect(m.sendDonorEmail).not.toHaveBeenCalled();
  });
  it("computes flags on the server and rejects client-sent flags", async () => {
    const bad = await POST(req({ ...good, flagged: false }));
    expect(bad.status).toBe(400);
    await POST(req({ ...good, recentDonation: true }));
    expect(m.registerDonor).toHaveBeenCalledWith(
      expect.objectContaining({ flagged: true, flagReasons: ["recent_donation"], recentDonation: true }),
    );
    m.registerDonor.mockClear();
    await POST(req({ ...good, dob: "2010-01-01", onMedication: true }));
    expect(m.registerDonor).toHaveBeenCalledWith(
      expect.objectContaining({ flagged: true, flagReasons: ["on_medication", "age_out_of_range"] }),
    );
  });
  it("registers without flags when answers are safe", async () => {
    await POST(req(good));
    expect(m.registerDonor).toHaveBeenCalledWith(expect.objectContaining({ flagged: false, flagReasons: [] }));
  });
  it("500 generic when registerDonor throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    m.registerDonor.mockRejectedValue(new Error("db exploded for Ali 990101123"));
    const res = await POST(req(good));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ ok: false, error: "server" });
  });
});
