import { describe, expect, it } from "vitest";
import { classifySubmit, retryDelay } from "@/lib/submit-retry";

describe("classifySubmit", () => {
  it("network error is retryable", () => {
    expect(classifySubmit({ networkError: true })).toEqual({ kind: "retryable", reason: "network" });
  });
  it("2xx with ok:true is success, other 2xx is a bad response", () => {
    expect(classifySubmit({ status: 200, json: { ok: true } })).toEqual({ kind: "success" });
    expect(classifySubmit({ status: 200, json: {} })).toEqual({ kind: "retryable", reason: "bad_response", status: 200 });
    expect(classifySubmit({ status: 204, json: null }).kind).toBe("retryable");
  });
  it("408 is a network-type retry", () => {
    expect(classifySubmit({ status: 408, json: {} })).toMatchObject({ kind: "retryable", reason: "network" });
  });
  it("5xx is a server retry with the status", () => {
    expect(classifySubmit({ status: 503, json: {} })).toEqual({ kind: "retryable", reason: "server", status: 503 });
    expect(classifySubmit({ status: 500, json: {} }).kind).toBe("retryable");
  });
  it("other 4xx are fatal and carry the error code", () => {
    for (const [status, error] of [[409, "duplicate_cpr"], [429, "rate_limited"], [403, "turnstile"], [403, "registration_closed"], [400, "validation"], [413, "too_large"]] as const) {
      expect(classifySubmit({ status, json: { ok: false, error } })).toEqual({ kind: "fatal", error, status });
    }
    expect(classifySubmit({ status: 400, json: null })).toEqual({ kind: "fatal", error: "server", status: 400 });
  });
});

describe("retryDelay", () => {
  it("stays within +/-20% of the base", () => {
    expect(retryDelay(0, () => 0)).toBe(1200);
    expect(retryDelay(0, () => 1)).toBe(1800);
    expect(retryDelay(1, () => 0)).toBe(3200);
    expect(retryDelay(1, () => 1)).toBe(4800);
    expect(retryDelay(5, () => 0.5)).toBe(4000);
  });
});
