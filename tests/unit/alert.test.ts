import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const after = vi.hoisted(() => vi.fn());
vi.mock("next/server", () => ({ after }));

const URL_OK = "https://discord.com/api/webhooks/1/abc";
let reportAlert: typeof import("@/lib/alert").reportAlert;
let reportSubmission: typeof import("@/lib/alert").reportSubmission;
const fetchMock = vi.fn();

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  after.mockImplementation((fn: () => unknown) => void fn());
  fetchMock.mockResolvedValue({ ok: true });
  vi.stubGlobal("fetch", fetchMock);
  delete process.env.DISCORD_WEBHOOK_URL;
  ({ reportAlert, reportSubmission } = await import("@/lib/alert"));
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.DISCORD_WEBHOOK_URL;
});

describe("reportAlert", () => {
  it("does nothing without a webhook or with a non-Discord url", () => {
    reportAlert({ event: "signup_error" });
    process.env.DISCORD_WEBHOOK_URL = "https://example.com/api/webhooks/1";
    reportAlert({ event: "signup_error", code: "x" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("posts JSON with a timeout signal", () => {
    process.env.DISCORD_WEBHOOK_URL = URL_OK;
    reportAlert({ event: "signup_error", code: "server" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(URL_OK);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body).allowed_mentions).toEqual({ parse: [] });
    expect(init.signal).toBeDefined();
  });
  it("does not throw when fetch rejects", async () => {
    process.env.DISCORD_WEBHOOK_URL = URL_OK;
    fetchMock.mockRejectedValue(new Error("net"));
    expect(() => reportAlert({ event: "email_failed" })).not.toThrow();
    await Promise.resolve();
  });
  it("sends directly when after() throws", () => {
    process.env.DISCORD_WEBHOOK_URL = URL_OK;
    after.mockImplementation(() => {
      throw new Error("outside request scope");
    });
    reportAlert({ event: "cron_step_failed", code: "ping" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("dedups two identical alerts", () => {
    process.env.DISCORD_WEBHOOK_URL = URL_OK;
    reportAlert({ event: "signup_error", code: "server" });
    reportAlert({ event: "signup_error", code: "server" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("reportAlert per donor and admin link", () => {
  const A = "abcdef12-3456-4890-8bcd-ef1234567890";
  const B = "abcdef12-3456-4890-8bcd-ef1234567891";
  it("posts email_failed for two different donors, and dedups the same donor", () => {
    process.env.DISCORD_WEBHOOK_URL = URL_OK;
    reportAlert({ event: "email_failed", donorId: A });
    reportAlert({ event: "email_failed", donorId: B });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    reportAlert({ event: "email_failed", donorId: A });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("keys on the person when there is no donor id", () => {
    process.env.DISCORD_WEBHOOK_URL = URL_OK;
    reportAlert({ event: "signup_error", code: "server", person: { phone: "33334444" } });
    reportAlert({ event: "signup_error", code: "server", person: { phone: "33335555" } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("keeps the person out of the key for client_error, so varying it cannot flood the cap", () => {
    process.env.DISCORD_WEBHOOK_URL = URL_OK;
    for (let i = 0; i < 20; i++) {
      reportAlert({ event: "client_error", code: "submit_network", person: { phone: `3333${String(i).padStart(4, "0")}` } });
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
    reportAlert({ event: "signup_error", code: "server", person: { phone: "33334444" } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("adds an admin link when NEXT_PUBLIC_SITE_URL is set", () => {
    process.env.DISCORD_WEBHOOK_URL = URL_OK;
    process.env.NEXT_PUBLIC_SITE_URL = "https://example.org";
    try {
      reportAlert({ event: "email_failed", donorId: A });
    } finally {
      delete process.env.NEXT_PUBLIC_SITE_URL;
    }
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body).content).toContain(`🔗 admin: https://example.org/admin/donors/${A}`);
  });
});

describe("reportSubmission", () => {
  it("does nothing without a webhook or with a non-Discord url", () => {
    reportSubmission({ outcome: "success" });
    process.env.DISCORD_WEBHOOK_URL = "https://example.com/api/webhooks/1";
    reportSubmission({ outcome: "success" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("posts twice for two identical notices (no dedup)", () => {
    process.env.DISCORD_WEBHOOK_URL = URL_OK;
    reportSubmission({ outcome: "success", mode: "slot" });
    reportSubmission({ outcome: "success", mode: "slot" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body).content).toContain("signup ok");
  });
  it("stops after 25 in a minute and counts the rest as suppressed", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-10-16T06:00:00Z"));
      process.env.DISCORD_WEBHOOK_URL = URL_OK;
      for (let i = 0; i < 30; i++) reportSubmission({ outcome: "server" });
      expect(fetchMock).toHaveBeenCalledTimes(25);
      vi.setSystemTime(new Date("2026-10-16T06:01:01Z"));
      reportSubmission({ outcome: "server" });
      expect(fetchMock).toHaveBeenCalledTimes(26);
      expect(JSON.parse(fetchMock.mock.calls[25]![1].body).content).toContain("suppressed since last: 5");
    } finally {
      vi.useRealTimers();
    }
  });
  it("does not throw when fetch rejects or when after() throws", () => {
    process.env.DISCORD_WEBHOOK_URL = URL_OK;
    fetchMock.mockRejectedValue(new Error("net"));
    after.mockImplementation(() => {
      throw new Error("outside request scope");
    });
    expect(() => reportSubmission({ outcome: "server" })).not.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
