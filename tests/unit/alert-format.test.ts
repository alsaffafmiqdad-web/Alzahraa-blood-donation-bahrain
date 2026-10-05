import { describe, expect, it } from "vitest";
import { createAlertGate, formatAlert, redact } from "@/lib/alert-format";

describe("redact", () => {
  it("removes a CPR, a phone, an email, Arabic-Indic digits and mentions", () => {
    const out = redact("cpr 990101123 phone 33334444 mail ali@example.com ٩٩٠١٠١١٢٣ @everyone");
    expect(out).not.toMatch(/\d{6,}/);
    expect(out).not.toContain("ali@example.com");
    expect(out).not.toContain("@");
    expect(out).toContain("[email]");
    expect(out).toContain("[digits]");
  });
  it("truncates", () => {
    expect(redact("a".repeat(500)).length).toBe(200);
    expect(redact("a".repeat(500), 10).length).toBe(10);
  });
});

describe("formatAlert", () => {
  const ID = "abcdef12-3456-4890-8bcd-ef1234567890";
  it("never allows mentions", () => {
    expect(formatAlert({ event: "signup_error" }, "prod", 0).allowed_mentions.parse).toEqual([]);
  });
  it("drops a donor id that is not a uuid, keeps a uuid", () => {
    expect(formatAlert({ event: "email_failed", donorId: "990101123" }, "prod", 0).content).not.toContain("donor:");
    expect(formatAlert({ event: "email_failed", donorId: ID }, "prod", 0).content).toContain(`donor: ${ID}`);
  });
  it("stays within 1900 characters", () => {
    const a = { event: "signup_error" as const, code: "c".repeat(500), detail: "d".repeat(5000) };
    expect(formatAlert(a, "prod", 3).content.length).toBeLessThanOrEqual(1900);
  });
  it("shows the suppressed line only when positive", () => {
    expect(formatAlert({ event: "signup_error" }, "prod", 4).content).toContain("suppressed since last: 4");
    expect(formatAlert({ event: "signup_error" }, "prod", 0).content).not.toContain("suppressed");
  });
});

describe("createAlertGate", () => {
  it("dedups the same key for 5 minutes and reports the suppressed count", () => {
    let now = 1_000_000;
    const g = createAlertGate({ now: () => now });
    expect(g.allow("a")).toEqual({ ok: true, suppressed: 0 });
    expect(g.allow("a")).toEqual({ ok: false });
    now += 299_000;
    expect(g.allow("a")).toEqual({ ok: false });
    now += 2_000;
    expect(g.allow("a")).toEqual({ ok: true, suppressed: 2 });
  });
  it("caps at 10 allowed per minute", () => {
    let now = 1_000_000;
    const g = createAlertGate({ now: () => now });
    for (let i = 0; i < 10; i++) expect(g.allow(`k${i}`).ok).toBe(true);
    expect(g.allow("k10")).toEqual({ ok: false });
    now += 60_000;
    expect(g.allow("k11")).toEqual({ ok: true, suppressed: 1 });
  });
});
