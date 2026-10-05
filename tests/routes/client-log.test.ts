import { beforeEach, describe, expect, it, vi } from "vitest";

const reportAlert = vi.hoisted(() => vi.fn());
vi.mock("@/lib/alert", () => ({ reportAlert }));

import { POST } from "@/app/api/client-log/route";

function post(body: unknown, headers: Record<string, string> = { "content-type": "application/json" }) {
  return POST(new Request("http://site.test/api/client-log", { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) }));
}

beforeEach(() => vi.clearAllMocks());

describe("POST /api/client-log", () => {
  it("204 and one alert for a valid report", async () => {
    const res = await post({ code: "submit_network", step: "review", status: 0, attempt: 2, locale: "ar" });
    expect(res.status).toBe(204);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(reportAlert).toHaveBeenCalledTimes(1);
    expect(reportAlert).toHaveBeenCalledWith({ event: "client_error", code: "submit_network", detail: "step=review status=0 attempt=2 locale=ar" });
  });
  it("uses - for missing values", async () => {
    await post({ code: "turnstile_timeout" });
    expect(reportAlert.mock.calls[0]![0].detail).toBe("step=- status=- attempt=- locale=-");
  });
  it("400 on an unknown key or code", async () => {
    expect((await post({ code: "submit_network", name: "Ali" })).status).toBe(400);
    expect((await post({ code: "nope" })).status).toBe(400);
    expect((await post("{bad")).status).toBe(400);
    expect(reportAlert).not.toHaveBeenCalled();
  });
  it("413 over 1024 characters", async () => {
    expect((await post({ code: "submit_network", locale: "x".repeat(2000) })).status).toBe(413);
  });
  it("403 for a foreign origin, allowed for the same origin", async () => {
    expect((await post({ code: "submit_network" }, { "content-type": "application/json", origin: "https://evil.test" })).status).toBe(403);
    expect((await post({ code: "submit_network" }, { "content-type": "application/json", origin: "http://site.test" })).status).toBe(204);
  });
  it("415 for a non-JSON content type", async () => {
    expect((await post({ code: "submit_network" }, { "content-type": "text/plain" })).status).toBe(415);
  });
});
