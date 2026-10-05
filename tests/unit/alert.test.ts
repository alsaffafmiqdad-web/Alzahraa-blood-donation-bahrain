import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const after = vi.hoisted(() => vi.fn());
vi.mock("next/server", () => ({ after }));

const URL_OK = "https://discord.com/api/webhooks/1/abc";
let reportAlert: typeof import("@/lib/alert").reportAlert;
const fetchMock = vi.fn();

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  after.mockImplementation((fn: () => unknown) => void fn());
  fetchMock.mockResolvedValue({ ok: true });
  vi.stubGlobal("fetch", fetchMock);
  delete process.env.DISCORD_WEBHOOK_URL;
  ({ reportAlert } = await import("@/lib/alert"));
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
