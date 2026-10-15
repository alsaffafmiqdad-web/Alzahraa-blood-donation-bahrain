import { describe, expect, it } from "vitest";
import {
  cleanContact,
  createAlertGate,
  formatAlert,
  formatSubmission,
  personFromPayload,
  PERSON_MAX,
  redact,
  STATUS_EMOJI,
} from "@/lib/alert-format";
import { STATUSES } from "@/lib/config";

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
    expect(formatAlert({ event: "email_failed", donorId: ID }, "prod", 0).content).toContain(`🆔 donor: ${ID}`);
  });
  it("adds an action line for email_auth_failed and no donor line", () => {
    const { content } = formatAlert({ event: "email_auth_failed", detail: "smtp EAUTH 534: Invalid login" }, "production", 0);
    expect(content).toContain("action: Gmail rejected the login");
    expect(content).not.toContain("donor:");
  });
  it("has no action line for email_failed", () => {
    expect(formatAlert({ event: "email_failed", detail: "boom" }, "prod", 0).content).not.toContain("action:");
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

describe("formatSubmission", () => {
  const ID = "abcdef12-3456-4890-8bcd-ef1234567890";
  it("formats a slot success", () => {
    const { content, allowed_mentions } = formatSubmission({ outcome: "success", mode: "slot", donorId: ID }, "prod", 0);
    expect(content).toBe(`✅ **[prod] signup ok**\n🗓️ mode: slot\n🆔 donor: ${ID}`);
    expect(allowed_mentions.parse).toEqual([]);
  });
  it("formats a walk-in success with the queue number", () => {
    const { content } = formatSubmission({ outcome: "success", mode: "walk_in", donorId: ID, queueNumber: 12 }, "prod", 0);
    expect(content).toBe(`✅ **[prod] signup ok**\n🎟️ queue: 12\n🚶 mode: walk_in\n🆔 donor: ${ID}`);
  });
  it("marks a replay", () => {
    const { content } = formatSubmission({ outcome: "replay", mode: "slot", donorId: ID }, "prod", 0);
    expect(content.split("\n").slice(0, 2)).toEqual(["🔁 **[prod] signup ok** (replay)", "🗓️ mode: slot"]);
  });
  it("lists failed field keys and codes, never values, with redaction applied", () => {
    const { content } = formatSubmission(
      {
        outcome: "validation",
        mode: "slot",
        fields: { cpr: "cpr_invalid", "x@everyone": "990101123456", phone: "phone_invalid" },
      },
      "prod",
      0,
    );
    expect(content).toContain("**[prod] signup failed: validation**");
    expect(content).toContain("fields: cpr=cpr_invalid, ");
    expect(content).toContain("phone=phone_invalid");
    expect(content).not.toMatch(/\d{6,}/);
    expect(content).not.toContain("@");
  });
  it("keeps at most 10 fields", () => {
    const fields = Object.fromEntries(Array.from({ length: 15 }, (_, i) => [`f${i}`, "c"]));
    const line = formatSubmission({ outcome: "validation", fields }, "prod", 0).content.split("\n").find((l) => l.startsWith("📝 fields:"))!;
    expect(line.split(", ")).toHaveLength(10);
  });
  it("drops a donor id that is not a uuid and leaves out missing lines", () => {
    const { content } = formatSubmission({ outcome: "turnstile", donorId: "990101123" }, "prod", 0);
    expect(content).toBe("❌ **[prod] signup failed: turnstile**");
  });
  it("shows the suppressed line only when positive, and stays within 1900 characters", () => {
    expect(formatSubmission({ outcome: "server" }, "prod", 3).content).toContain("suppressed since last: 3");
    expect(formatSubmission({ outcome: "server" }, "prod", 0).content).not.toContain("suppressed");
    const fields = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`k${i}`.padEnd(60, "k"), "v".repeat(100)]));
    expect(formatSubmission({ outcome: "validation", fields }, "p".repeat(500), 1).content.length).toBeLessThanOrEqual(1900);
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

describe("cleanContact", () => {
  it("collapses whitespace and control characters, swaps backticks, trims and caps", () => {
    expect(cleanContact("  Ali\n\tHassan\u0000 `x`  ", 50)).toBe("Ali Hassan 'x'");
    expect(cleanContact("a".repeat(50), 10)).toBe("a".repeat(10));
  });
  it("does not redact", () => {
    expect(cleanContact("ali@example.com 33334444", 50)).toBe("ali@example.com 33334444");
  });
});

describe("personFromPayload", () => {
  it("takes fullName, email and phone only, and never the CPR or DOB", () => {
    const p = personFromPayload({ fullName: " Ali ", email: "a@x.com", phone: "33334444", cpr: "990101123", dob: "1990-01-01" });
    expect(p).toEqual({ name: "Ali", email: "a@x.com", phone: "33334444" });
    expect(JSON.stringify(p)).not.toContain("990101123");
  });
  it("ignores non-strings and empty strings, and returns undefined when nothing is left", () => {
    expect(personFromPayload({ fullName: 5, email: "", phone: "   " })).toBeUndefined();
    expect(personFromPayload(null)).toBeUndefined();
    expect(personFromPayload("x")).toBeUndefined();
    expect(personFromPayload({ fullName: ["a"], phone: "3333" })).toEqual({ phone: "3333" });
  });
  it("caps lengths", () => {
    const p = personFromPayload({ fullName: "n".repeat(500), email: "e".repeat(500), phone: "1".repeat(500) })!;
    expect(p.name).toHaveLength(PERSON_MAX.name);
    expect(p.email).toHaveLength(PERSON_MAX.email);
    expect(p.phone).toHaveLength(PERSON_MAX.phone);
  });
});

describe("person lines", () => {
  const ID = "abcdef12-3456-4890-8bcd-ef1234567890";
  const person = { name: "Ali @everyone `x`", email: "ali@example.com", phone: "33334444" };
  it("formatSubmission shows them unredacted, in order, with the admin link", () => {
    const { content, allowed_mentions } = formatSubmission(
      { outcome: "success", mode: "slot", donorId: ID, queueNumber: 3, person, total: 12, status: "registered" },
      "prod",
      0,
      "https://example.org/some/path",
    );
    expect(content.split("\n")).toEqual([
      "✅ **[prod] signup ok**",
      "👥 total: 12",
      "👤 name: `Ali @everyone 'x'`",
      "📝 status: registered",
      "🎟️ queue: 3",
      "🗓️ mode: slot",
      "📧 email: `ali@example.com`",
      "📱 phone: `33334444`",
      `🆔 donor: ${ID}`,
      `🔗 admin: https://example.org/admin/donors/${ID}`,
    ]);
    expect(allowed_mentions.parse).toEqual([]);
  });
  it("formatAlert puts them after donor and before detail, and still redacts detail", () => {
    const { content } = formatAlert({ event: "email_failed", donorId: ID, person, detail: "to ali@example.com 33334444" }, "prod", 0, "http://localhost:3000");
    const lines = content.split("\n");
    expect(lines[0]).toBe("🚨 **[prod] email_failed**");
    expect(lines.slice(1, 6)).toEqual([
      `🆔 donor: ${ID}`,
      "👤 name: `Ali @everyone 'x'`",
      "📧 email: `ali@example.com`",
      "📱 phone: `33334444`",
      `🔗 admin: http://localhost:3000/admin/donors/${ID}`,
    ]);
    expect(lines[6]).toBe("detail: to [email] [digits]");
  });
  it("omits the admin line for a bad site URL, a non-http scheme, or a non-UUID id", () => {
    for (const url of ["", "not a url", "ftp://example.org", "javascript:alert(1)"]) {
      expect(formatAlert({ event: "email_failed", donorId: ID }, "p", 0, url).content).not.toContain("admin:");
    }
    expect(formatAlert({ event: "email_failed", donorId: "990101123" }, "p", 0, "https://e.org").content).not.toContain("admin:");
  });
  it("neutralises newlines, backticks and a mention in a name so it cannot inject lines or ping", () => {
    const evil = { name: "Ali\n🔗 admin: https://evil.example\n@everyone `code`" };
    for (const content of [
      formatSubmission({ outcome: "validation", person: evil }, "p", 0).content,
      formatAlert({ event: "signup_error", person: evil }, "p", 0).content,
    ]) {
      expect(content.split("\n").filter((l) => l.includes("evil.example") && l.startsWith("🔗"))).toEqual([]);
      expect(content.split("`")).toHaveLength(3); // exactly one code span: the value cannot break out
      expect(content).toContain("👤 name: `Ali 🔗 admin: https://evil.example @everyone 'code'`");
    }
    expect(formatAlert({ event: "signup_error", person: evil }, "p", 0).allowed_mentions.parse).toEqual([]);
  });
  it("keeps Discord markdown in person values inside code spans, and suppresses embeds", () => {
    const md = { name: "[x](https://evil.example) **bold**", email: "**e**@x.com", phone: "[p](https://evil.example)" };
    const outA = formatAlert({ event: "signup_error", person: md }, "p", 0);
    const outS = formatSubmission({ outcome: "validation", person: md }, "p", 0);
    for (const out of [outA, outS]) {
      expect(out.flags).toBe(4);
      for (const line of out.content.split("\n").slice(1)) {
        const outside = line.replace(/`[^`]*`/g, "");
        expect(outside).not.toContain("](");
        expect(outside).not.toContain("**");
        expect(outside).not.toContain("evil.example");
      }
      expect(out.content).toContain("`[x](https://evil.example) **bold**`");
    }
  });
  it("never shows a CPR or DOB even when the payload is invalid", () => {
    const p = personFromPayload({ fullName: 990101123, email: { cpr: "990101123" }, phone: ["990101123"], cpr: "990101123", dob: "1990-05-05" });
    expect(p).toBeUndefined();
    const { content } = formatSubmission({ outcome: "validation", person: p, fields: { cpr: "cpr_invalid" } }, "p", 0);
    expect(content).not.toContain("990101123");
    expect(content).not.toContain("1990");
  });
  it("omits total and status on a failure and a replay, and on an unknown outcome path", () => {
    expect(formatSubmission({ outcome: "server", total: 3, status: "donated" }, "p", 0).content).toBe("❌ **[p] signup failed: server**");
  });
  it("adds a Supabase hint and a where line for network failures only", () => {
    const hinted = formatAlert(
      { event: "join_load_failed", where: "/join", detail: "fetch failed (cause: ECONNREFUSED connect 127.0.0.1:54321)" },
      "local",
      0,
    ).content;
    expect(hinted.split("\n")).toEqual([
      "🚨 **[local] join_load_failed**",
      "where: /join",
      "detail: fetch failed (cause: ECONNREFUSED connect 127.0.0.1:54321)",
      "hint: can't reach Supabase. Locally, run `pnpm dlx supabase start`; on Vercel, check NEXT_PUBLIC_SUPABASE_URL and status.supabase.com.",
    ]);
    for (const detail of ["UND_ERR_CONNECT_TIMEOUT", "getaddrinfo ENOTFOUND x", "ETIMEDOUT", "TypeError: fetch failed"]) {
      expect(formatAlert({ event: "signup_error", detail }, "p", 0).content).toContain("hint: can't reach Supabase");
    }
    expect(formatAlert({ event: "join_load_failed", detail: "getEvent failed: no row" }, "p", 0).content).not.toContain("hint:");
    expect(formatAlert({ event: "email_failed", detail: "ECONNREFUSED" }, "p", 0).content).not.toContain("hint:");
  });
  it("shows the Supabase hint for cron and photo-upload network errors, and never on other events", () => {
    const detail = "fetch failed (cause: ECONNREFUSED connect 127.0.0.1:54321)";
    for (const event of ["cron_step_failed", "cpr_upload_failed"] as const) {
      expect(formatAlert({ event, detail }, "p", 0).content).toContain("hint: can't reach Supabase");
    }
    for (const event of ["email_failed", "card_token_failed", "signup_rate_limited", "client_error", "email_not_configured"] as const) {
      expect(formatAlert({ event, detail }, "p", 0).content).not.toContain("hint: can't reach Supabase");
    }
    expect(formatAlert({ event: "signup_error" }, "p", 0).content).not.toContain("hint:");
  });
  it("the where line shows only the static route, with no query string or personal data", () => {
    const person = { name: "Ali Hasan", email: "ali@example.com", phone: "33334444" };
    const lines = formatAlert({ event: "signup_error", where: "/api/signup", detail: "x", person }, "p", 0).content.split("\n");
    const where = lines.filter((l) => l.startsWith("where:"));
    expect(where).toEqual(["where: /api/signup"]);
    expect(where[0]).not.toMatch(/\?|Ali|ali@|3333/);
    expect(formatAlert({ event: "signup_error", detail: "x" }, "p", 0).content).not.toContain("where:");
  });
  it("redact keeps error codes, IP addresses and ports readable", () => {
    expect(redact("ECONNREFUSED connect 127.0.0.1:54321")).toBe("ECONNREFUSED connect 127.0.0.1:54321");
  });
  it("omits empty person fields", () => {
    const { content } = formatSubmission({ outcome: "validation", person: { name: "  ", email: null, phone: "3333" } }, "p", 0);
    expect(content).toBe("❌ **[p] signup failed: validation**\n📱 phone: `3333`");
  });
});

describe("success notice total and status", () => {
  it("shows total and status on success only", () => {
    const ok = formatSubmission({ outcome: "success", total: 0, status: "waiting" }, "p", 0).content;
    expect(ok).toContain("👥 total: 0");
    expect(ok).toContain("⏳ status: waiting");
    for (const outcome of ["replay", "validation"] as const) {
      const c = formatSubmission({ outcome, total: 5, status: "registered" }, "p", 0).content;
      expect(c).not.toContain("total");
      expect(c).not.toContain("status");
    }
  });
  it("omits an invalid total and an unknown status", () => {
    for (const total of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(formatSubmission({ outcome: "success", total }, "p", 0).content).not.toContain("total");
    }
    const c = formatSubmission({ outcome: "success", status: "mystery" as never }, "p", 0).content;
    expect(c).not.toContain("status");
  });
  it("has the right emoji for each status", () => {
    const expected = { registered: "📝", verified: "🪪", waiting: "⏳", screening: "🩺", donated: "🩸", deferred: "⏸️", no_show: "🚫" };
    expect(STATUS_EMOJI).toEqual(expected);
    for (const s of STATUSES) {
      expect(formatSubmission({ outcome: "success", status: s }, "p", 0).content).toContain(`${expected[s]} status: ${s}`);
    }
  });
});
