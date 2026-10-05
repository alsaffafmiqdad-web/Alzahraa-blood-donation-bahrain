import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EmailOutcome, RetryOptions } from "@/lib/email/dispatch";

const db = vi.hoisted(() => ({
  getDonorForEmail: vi.fn(),
  claimEmailSend: vi.fn(),
  finishEmailSend: vi.fn(),
}));
const sendConfirmationEmail = vi.hoisted(() => vi.fn());
const renderDonorCard = vi.hoisted(() => vi.fn());

const reportAlert = vi.hoisted(() => vi.fn());
vi.mock("@/lib/alert", () => ({ reportAlert }));
vi.mock("@/lib/db/email", () => db);
vi.mock("@/lib/email/send", () => ({ sendConfirmationEmail }));
vi.mock("@/lib/pdf/render", () => ({ renderDonorCard }));

import { runEmailRetry, sendDonorEmail } from "@/lib/email/dispatch";

describe("runEmailRetry", () => {
  const run = (outcomes: EmailOutcome[], limit: number, opts: RetryOptions = {}) => {
    const sent: string[] = [];
    const ids = outcomes.map((_, i) => `id${i}`);
    return runEmailRetry(
      {
        listCandidates: async (n) => ids.slice(0, n),
        send: async (id) => {
          sent.push(id);
          return outcomes[ids.indexOf(id)]!;
        },
      },
      limit,
      opts,
    ).then((r) => ({ r, sent }));
  };
  const zero = { attempted: 0, sent: 0, failed: 0, stoppedForBudget: false, stoppedForTime: false };
  it("returns zeros with no candidates", async () => {
    expect((await run([], 10)).r).toEqual(zero);
  });
  it("a limit of 0 (budget used up) sends nothing and reports the budget stop", async () => {
    const { r, sent } = await run(["sent"], 0);
    expect(sent).toEqual([]);
    expect(r).toEqual({ ...zero, stoppedForBudget: true });
  });
  it("counts sent and failed and continues after a failure", async () => {
    const { r } = await run(["sent", "failed", "sent"], 10);
    expect(r).toEqual({ ...zero, attempted: 3, sent: 2, failed: 1 });
  });
  it("sequentially, stops at the first queued", async () => {
    const { r, sent } = await run(["sent", "queued", "sent"], 10, { concurrency: 1 });
    expect(r).toEqual({ ...zero, attempted: 1, sent: 1, stoppedForBudget: true });
    expect(sent).toEqual(["id0", "id1"]);
  });
  it("respects the limit", async () => {
    const { r, sent } = await run(["sent", "sent", "sent", "sent"], 2);
    expect(r.attempted).toBe(2);
    expect(sent).toHaveLength(2);
  });
  it("never has more than `concurrency` sends in flight, and does use that many", async () => {
    let inFlight = 0;
    let peak = 0;
    const ids = Array.from({ length: 12 }, (_, i) => `id${i}`);
    const r = await runEmailRetry(
      {
        listCandidates: async () => ids,
        send: async () => {
          inFlight += 1;
          peak = Math.max(peak, inFlight);
          await new Promise((res) => setTimeout(res, 5));
          inFlight -= 1;
          return "sent";
        },
      },
      12,
      { concurrency: 3 },
    );
    expect(r.sent).toBe(12);
    expect(peak).toBe(3);
  });
  it("defaults to 5 at a time", async () => {
    let inFlight = 0;
    let peak = 0;
    await runEmailRetry(
      {
        listCandidates: async () => Array.from({ length: 20 }, (_, i) => `id${i}`),
        send: async () => {
          inFlight += 1;
          peak = Math.max(peak, inFlight);
          await new Promise((res) => setTimeout(res, 5));
          inFlight -= 1;
          return "sent";
        },
      },
      20,
    );
    expect(peak).toBe(5);
  });
  it("stops starting new sends once the deadline passes and leaves the rest for the next run", async () => {
    let clock = 0;
    const started: string[] = [];
    const ids = Array.from({ length: 10 }, (_, i) => `id${i}`);
    const r = await runEmailRetry(
      {
        listCandidates: async () => ids,
        send: async (id) => {
          started.push(id);
          clock += 10; // each send takes 10 ms of the fake clock
          return "sent";
        },
      },
      10,
      { concurrency: 1, deadline: 35, now: () => clock },
    );
    expect(started).toEqual(["id0", "id1", "id2", "id3"]); // clock reaches 40 >= 35 after the 4th
    expect(r.attempted).toBe(4);
    expect(r.stoppedForTime).toBe(true);
    expect(r.stoppedForBudget).toBe(false);
  });
  it("does not report a time stop when everything finished before the deadline", async () => {
    const { r } = await run(["sent", "sent"], 10, { deadline: Date.now() + 60_000 });
    expect(r.stoppedForTime).toBe(false);
    expect(r.sent).toBe(2);
  });
  it("in-flight sends finish after a budget stop, and no new ones start", async () => {
    const started: string[] = [];
    const r = await runEmailRetry(
      {
        listCandidates: async () => ["a", "b", "c", "d", "e", "f", "g", "h"],
        send: async (id) => {
          started.push(id);
          await new Promise((res) => setTimeout(res, 2));
          return id === "b" ? "queued" : "sent";
        },
      },
      8,
      { concurrency: 2 },
    );
    expect(r.stoppedForBudget).toBe(true);
    expect(started.length).toBeLessThan(8);
    expect(r.sent).toBe(started.length - 1);
  });
});

const donor = {
  id: "11111111-2222-4333-8444-555555555555",
  email: "ali@example.com",
  fullName: "Ali",
  bloodType: "O+",
  slotTime: "09:00:00",
  createdAt: "2026-10-03T10:00:00Z",
  event: { name_ar: "a", name_en: "b", location_ar: "", location_en: "", event_date: "2026-10-16", public_registration_open: true },
};

describe("sendDonorEmail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.RESEND_API_KEY = "re_test";
    process.env.RESEND_FROM_EMAIL = "Org <noreply@example.org>";
    db.getDonorForEmail.mockResolvedValue(donor);
    db.claimEmailSend.mockResolvedValue(7);
    renderDonorCard.mockResolvedValue(Buffer.from("%PDF"));
    sendConfirmationEmail.mockResolvedValue({ ok: true });
  });
  it("returns none and does not claim when there is no email", async () => {
    db.getDonorForEmail.mockResolvedValue({ ...donor, email: null });
    expect(await sendDonorEmail(donor.id)).toBe("none");
    expect(db.claimEmailSend).not.toHaveBeenCalled();
  });
  it("returns queued when Resend env is missing", async () => {
    delete process.env.RESEND_API_KEY;
    expect(await sendDonorEmail(donor.id)).toBe("queued");
    expect(db.claimEmailSend).not.toHaveBeenCalled();
  });
  it("reports email_failed with the donor id and no address", async () => {
    sendConfirmationEmail.mockResolvedValue({ ok: false, error: "smtp EAUTH 535: bad login" });
    await sendDonorEmail(donor.id);
    expect(reportAlert).toHaveBeenCalledWith({ event: "email_failed", donorId: donor.id, detail: "smtp EAUTH 535: bad login" });
    expect(JSON.stringify(reportAlert.mock.calls)).not.toContain("@");
  });
  it("reports email_not_configured when no provider is set", async () => {
    delete process.env.RESEND_API_KEY;
    await sendDonorEmail(donor.id);
    expect(reportAlert).toHaveBeenCalledWith({ event: "email_not_configured" });
  });
  it("returns queued without sending when the budget claim is null", async () => {
    db.claimEmailSend.mockResolvedValue(null);
    expect(await sendDonorEmail(donor.id)).toBe("queued");
    expect(sendConfirmationEmail).not.toHaveBeenCalled();
  });
  it("finishes the claim as success and returns sent", async () => {
    expect(await sendDonorEmail(donor.id)).toBe("sent");
    expect(db.finishEmailSend).toHaveBeenCalledWith(7, true, null);
  });
  it("finishes the claim as failure on a send error", async () => {
    sendConfirmationEmail.mockResolvedValue({ ok: false, error: "boom" });
    expect(await sendDonorEmail(donor.id)).toBe("failed");
    expect(db.finishEmailSend).toHaveBeenCalledWith(7, false, "boom");
  });
  it("never throws and logs only the id and message", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    renderDonorCard.mockRejectedValue(new Error("render exploded"));
    expect(await sendDonorEmail(donor.id)).toBe("failed");
    expect(db.finishEmailSend).toHaveBeenCalledWith(7, false, "render exploded");
    const logged = spy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(logged).toContain(`email error donor=${donor.id}: render exploded`);
    expect(logged).not.toContain("ali@example.com");
    spy.mockRestore();
  });
  it("returns failed when the lookup throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    db.getDonorForEmail.mockRejectedValue(new Error("db down"));
    expect(await sendDonorEmail(donor.id)).toBe("failed");
  });
});
