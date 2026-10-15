import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  ping: vi.fn(),
  dailyMaintenance: vi.fn(),
  listRetryCandidates: vi.fn(),
  emailBudgetRemaining: vi.fn(),
  sendDonorEmail: vi.fn(),
}));
const reportAlert = vi.hoisted(() => vi.fn());
vi.mock("@/lib/alert", () => ({ reportAlert }));
vi.mock("@/lib/db/maintenance", () => ({ ping: m.ping, dailyMaintenance: m.dailyMaintenance }));
vi.mock("@/lib/db/email", () => ({
  listRetryCandidates: m.listRetryCandidates,
  emailBudgetRemaining: m.emailBudgetRemaining,
}));
vi.mock("@/lib/email/dispatch", async () => {
  const actual = await vi.importActual<typeof import("@/lib/email/dispatch")>("@/lib/email/dispatch").catch(() => null);
  return {
    sendDonorEmail: m.sendDonorEmail,
    runEmailRetry: actual?.runEmailRetry,
  };
});

import { GET } from "@/app/api/cron/daily/route";

const get = (auth?: string) =>
  GET(new Request("http://x/api/cron/daily", { headers: auth ? { authorization: auth } : {} }));

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = "s3cret-value";
  m.ping.mockResolvedValue(undefined);
  m.dailyMaintenance.mockResolvedValue(undefined);
  m.listRetryCandidates.mockResolvedValue(["a", "b"]);
  m.emailBudgetRemaining.mockResolvedValue(95);
  m.sendDonorEmail.mockResolvedValue("sent");
});

describe("GET /api/cron/daily", () => {
  it("401 without or with a wrong bearer", async () => {
    expect((await get()).status).toBe(401);
    expect((await get("Bearer nope")).status).toBe(401);
    expect(m.ping).not.toHaveBeenCalled();
  });
  it("401 when CRON_SECRET is unset", async () => {
    delete process.env.CRON_SECRET;
    expect((await get("Bearer undefined")).status).toBe(401);
  });
  it("runs ping, maintenance and retry with the right bearer", async () => {
    const res = await get("Bearer s3cret-value");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.retry).toEqual({ attempted: 2, sent: 2, failed: 0, stoppedForBudget: false, stoppedForTime: false, stoppedForAuth: false });
    expect(m.ping).toHaveBeenCalled();
    expect(m.dailyMaintenance).toHaveBeenCalled();
  });
  it("reports a failing step as cron_step_failed", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    m.ping.mockRejectedValue(new Error("down"));
    await get("Bearer s3cret-value");
    expect(reportAlert).toHaveBeenCalledWith({ event: "cron_step_failed", code: "ping", where: "/api/cron/daily", detail: "down" });
  });
  it("the per-run cap is whatever is left of the rolling budget", async () => {
    m.emailBudgetRemaining.mockResolvedValue(17);
    await get("Bearer s3cret-value");
    expect(m.listRetryCandidates).toHaveBeenCalledWith(17);
  });
  it("sends nothing when the budget is used up", async () => {
    m.emailBudgetRemaining.mockResolvedValue(0);
    const body = await (await get("Bearer s3cret-value")).json();
    expect(m.listRetryCandidates).not.toHaveBeenCalled();
    expect(m.sendDonorEmail).not.toHaveBeenCalled();
    expect(body.retry.stoppedForBudget).toBe(true);
  });
  it("stops after an auth failure and reports a summary with auth_stop=true", async () => {
    m.listRetryCandidates.mockResolvedValue(Array.from({ length: 30 }, (_, i) => `id${i}`));
    m.sendDonorEmail.mockResolvedValue("auth_failed");
    const body = await (await get("Bearer s3cret-value")).json();
    expect(body.retry.stoppedForAuth).toBe(true);
    expect(body.retry.sent).toBe(0);
    expect(m.sendDonorEmail.mock.calls.length).toBeLessThan(30);
    const summary = reportAlert.mock.calls.map((c) => c[0]).find((a) => a.event === "cron_email_summary");
    expect(summary.detail).toContain("auth_stop=true");
  });
  it("a clean run sends no summary", async () => {
    await get("Bearer s3cret-value");
    expect(reportAlert).not.toHaveBeenCalledWith(expect.objectContaining({ event: "cron_email_summary" }));
  });
  it("declares the Hobby maximum duration", async () => {
    const route = await import("@/app/api/cron/daily/route");
    expect(route.maxDuration).toBe(300);
  });
  it("still runs retry when ping fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    m.ping.mockRejectedValue(new Error("down"));
    const body = await (await get("Bearer s3cret-value")).json();
    expect(body.steps.ping).toBe(false);
    expect(m.sendDonorEmail).toHaveBeenCalledTimes(2);
  });
});
