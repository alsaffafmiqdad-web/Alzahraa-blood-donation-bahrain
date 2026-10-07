import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { BLOOD_TYPES as APP_BLOOD_TYPES, GMAIL_DEFAULT_BUDGET as APP_BUDGET, SIGNUP_RATE_LIMIT } from "@/lib/config";
import { sniffImageType } from "@/lib/cpr-image";
import { isWalkInMode } from "@/lib/event-mode";
import { signupSchema, signupWalkInSchema } from "@/lib/validation";
import {
  APP_ENV_KEYS,
  BLOOD_TYPES,
  GMAIL_DEFAULT_BUDGET,
  RATE_LIMIT,
  buildChildEnv,
  buildMultipart,
  checkQueue,
  classifyResponse,
  emailOutcome,
  pendingEmailCount,
  isLoadtestCpr,
  isWalkInNow,
  parseArgs,
  parseEnvFile,
  percentile,
  planSlots,
  rateLimitKey,
  summarise,
  syntheticCpr,
  syntheticDonor,
  letterIndex,
  syntheticEmail,
  syntheticIp,
  syntheticJpeg,
  verdict,
} from "../../scripts/loadtest/lib.mjs";

const prod = ["--target", "production", "--env-file", ".env.loadtest-x", "--email-base", "owner@example.com"];
const opts = (args: string[]) => {
  const r = parseArgs(args);
  if (!r.ok) throw new Error(r.error);
  return r.options;
};
const err = (args: string[]) => {
  const r = parseArgs(args);
  if (r.ok) throw new Error("expected an error");
  return r.error;
};

describe("parseArgs", () => {
  it("allows production cleanup without --email-base (cleanup sends no email)", () => {
    expect(opts(["--cleanup-only", "--target", "production", "--env-file", ".env.loadtest-production"])).toMatchObject({
      target: "production", cleanupOnly: true, emailBase: null,
    });
  });
  it("still requires --email-base for a production run that is not cleanup only", () => {
    const r = parseArgs(["--target", "production", "--env-file", ".env.loadtest-production"]);
    expect(r.ok).toBe(false);
  });
  it("has the documented defaults", () => {
    expect(opts([])).toMatchObject({
      target: "local", envFile: null, emailBase: null, yes: false, users: 50, dup: 10, replay: 5,
      rateLimitRequests: 30, imageBytes: 500000, mode: "both", port: 3100, p95BudgetMs: 10000,
      timeoutMs: 65000, maxEmails: 80, reservePlaces: 25, skipRateLimitCheck: false, noCard: false,
      keep: false, cleanupOnly: false,
    });
  });
  it.each([
    ["--users", 1, 500],
    ["--dup", 2, 50],
    ["--replay", 2, 20],
    ["--rate-limit-requests", 26, 100],
    ["--image-bytes", 1024, 2000000],
    ["--port", 1024, 65535],
  ])("%s accepts %i..%i and rejects outside", (flag, min, max) => {
    expect(parseArgs([flag, String(min)]).ok).toBe(true);
    expect(parseArgs([flag, String(max)]).ok).toBe(true);
    expect(parseArgs([flag, String(min - 1)]).ok).toBe(false);
    expect(parseArgs([flag, String(max + 1)]).ok).toBe(false);
    expect(parseArgs([flag, "1.5"]).ok).toBe(false);
    expect(parseArgs([flag]).ok).toBe(false);
  });
  it("checks the open-ended numbers", () => {
    expect(parseArgs(["--p95-budget-ms", "0"]).ok).toBe(false);
    expect(parseArgs(["--timeout-ms", "0"]).ok).toBe(false);
    expect(parseArgs(["--reserve-places", "0"]).ok).toBe(true);
    expect(parseArgs(["--reserve-places", "-1"]).ok).toBe(false);
    expect(parseArgs([...prod, "--max-emails", "450"]).ok).toBe(true);
    expect(parseArgs([...prod, "--max-emails", "451"]).ok).toBe(false);
    expect(parseArgs([...prod, "--max-emails", "0"]).ok).toBe(false);
  });
  it("rejects unknown flags and bad enums", () => {
    expect(err(["--nope"])).toContain("Unknown option");
    expect(parseArgs(["--mode", "x"]).ok).toBe(false);
    expect(parseArgs(["--target", "staging"]).ok).toBe(false);
  });
  it("production needs --env-file and --email-base", () => {
    expect(err(["--target", "production"])).toContain("--env-file");
    expect(err(["--target", "production", "--env-file", "f"])).toContain("--email-base");
    const o = opts(prod);
    expect(o).toMatchObject({ target: "production", mode: "slot", envFile: ".env.loadtest-x" });
  });
  it("rejects --env-file and --email-base with local", () => {
    expect(parseArgs(["--env-file", "f"]).ok).toBe(false);
    expect(parseArgs(["--email-base", "owner@example.com"]).ok).toBe(false);
  });
  it("production rejects walk-in, both and keep, but accepts an explicit slot", () => {
    expect(parseArgs([...prod, "--mode", "walk-in"]).ok).toBe(false);
    expect(parseArgs([...prod, "--mode", "both"]).ok).toBe(false);
    expect(parseArgs([...prod, "--keep"]).ok).toBe(false);
    expect(parseArgs([...prod, "--mode", "slot"]).ok).toBe(true);
  });
  it("rejects a + in the email base", () => {
    const bad = ["--target", "production", "--env-file", "f", "--email-base", "own+er@example.com"];
    expect(err(bad)).toContain("--email-base");
    expect(parseArgs(["--target", "production", "--env-file", "f", "--email-base", "nope"]).ok).toBe(false);
  });
});

describe("parseEnvFile", () => {
  it("handles comments, blanks, quotes and = inside values", () => {
    const env = parseEnvFile(
      ["# comment", "", "A=1", 'B="two words"', "C='x=y'", "D=a=b=c", "  E = padded ", "export F=6", "EMPTY="].join("\n"),
    );
    expect(env).toEqual({ A: "1", B: "two words", C: "x=y", D: "a=b=c", E: "padded", F: "6", EMPTY: "" });
  });
});

describe("constants that mirror the app", () => {
  it("APP_ENV_KEYS equals the keys in .env.example", () => {
    const keys = fs
      .readFileSync(".env.example", "utf8")
      .split("\n")
      .map((l) => /^([A-Z0-9_]+)=/.exec(l)?.[1])
      .filter(Boolean);
    expect(APP_ENV_KEYS).toEqual(keys);
  });
  it("matches lib/config.ts", () => {
    expect(RATE_LIMIT).toBe(SIGNUP_RATE_LIMIT.limit);
    expect(BLOOD_TYPES).toEqual([...APP_BLOOD_TYPES]);
    expect(GMAIL_DEFAULT_BUDGET).toBe(APP_BUDGET);
  });
});

describe("buildChildEnv", () => {
  const target = { NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321", GMAIL_USER: "u@example.com", DISCORD_WEBHOOK_URL: "x", TURNSTILE_SECRET_KEY: "real" };
  it("sets every app key and overrides the safety ones", () => {
    const env = buildChildEnv({ PATH: "/bin", VERCEL_ENV: "production", RESEND_API_KEY: "leak" }, target, "local");
    for (const k of APP_ENV_KEYS) expect(k in env).toBe(true);
    expect(env.PATH).toBe("/bin");
    expect("VERCEL_ENV" in env).toBe(false);
    expect(env.DISCORD_WEBHOOK_URL).toBe("");
    expect(env.TURNSTILE_SECRET_KEY).toBe("1x0000000000000000000000000000000AA");
    expect(env.GMAIL_USER).toBe("");
    expect(env.RESEND_API_KEY).toBe("");
  });
  it("production keeps the Gmail values", () => {
    expect(buildChildEnv({}, target, "production").GMAIL_USER).toBe("u@example.com");
  });
});

describe("synthetic data", () => {
  it("syntheticCpr and isLoadtestCpr", () => {
    expect(syntheticCpr(0)).toBe("990000000");
    expect(syntheticCpr(99999)).toBe("990099999");
    expect(syntheticCpr(42)).toMatch(/^9900\d{5}$/);
    expect(() => syntheticCpr(100000)).toThrow();
    expect(() => syntheticCpr(-1)).toThrow();
    expect(() => syntheticCpr(1.5)).toThrow();
    expect(isLoadtestCpr("990000042")).toBe(true);
    expect(isLoadtestCpr("123456789")).toBe(false);
    expect(isLoadtestCpr("9900000421")).toBe(false);
  });
  it("syntheticEmail", () => {
    expect(syntheticEmail(3, { emailBase: "owner@example.com", runTag: "ab12" })).toBe("owner+lt-ab12-3@example.com");
    expect(syntheticEmail(3)).toBe("loadtest-3@example.invalid");
    const field = signupSchema.shape.email;
    expect(field.safeParse(syntheticEmail(3, { emailBase: "owner@example.com", runTag: "ab12" })).success).toBe(true);
    expect(field.safeParse(syntheticEmail(3)).success).toBe(true);
  });
  it("letterIndex gives distinct letter-only suffixes", () => {
    expect([0, 25, 26, 27, 675, 676].map(letterIndex)).toEqual(["a", "z", "ba", "bb", "zz", "baa"]);
    const seen = new Set(Array.from({ length: 2000 }, (_, i) => letterIndex(i)));
    expect(seen.size).toBe(2000);
  });
  it("syntheticDonor passes both schemas", () => {
    for (let i = 0; i < 20; i++) {
      const slot = syntheticDonor(i, { slotId: 3, emailBase: "owner@example.com", runTag: "ab12" });
      expect(signupSchema.safeParse(slot).success).toBe(true);
      const walk = syntheticDonor(i, { walkIn: true, runTag: "ab12" });
      expect(signupWalkInSchema.safeParse(walk).success).toBe(true);
      expect("slotId" in walk).toBe(false);
      expect(slot.fullName).toBe(`Loadtest Donor ${letterIndex(i)}`);
    }
    expect(syntheticDonor(0, { slotId: 1 }).onMedication).toBe(true);
    expect(syntheticDonor(1, { slotId: 1 }).onMedication).toBe(false);
  });
  it("syntheticJpeg", () => {
    for (const size of [1024, 65540, 500000, 2000000]) {
      const b = syntheticJpeg(size, 7);
      expect(b.length).toBe(size);
      expect(sniffImageType(b)).toBe("jpg");
      expect([b[size - 2], b[size - 1]]).toEqual([0xff, 0xd9]);
      // walk the COM segments
      let pos = 20;
      while (pos < size - 2) {
        expect([b[pos], b[pos + 1]]).toEqual([0xff, 0xfe]);
        const len = b.readUInt16BE(pos + 2);
        expect(len).toBeGreaterThanOrEqual(2);
        expect(len).toBeLessThanOrEqual(65535);
        pos += 2 + len;
      }
      expect(pos).toBe(size - 2);
    }
    expect(syntheticJpeg(2048, 1).equals(syntheticJpeg(2048, 1))).toBe(true);
    expect(syntheticJpeg(2048, 1).equals(syntheticJpeg(2048, 2))).toBe(false);
  });
  it("buildMultipart round-trips through Request.formData()", async () => {
    const image = syntheticJpeg(2048, 3);
    const { body, contentType } = buildMultipart({ a: 1 }, image);
    const form = await new Request("http://x/", { method: "POST", headers: { "content-type": contentType }, body: new Uint8Array(body) }).formData();
    expect(JSON.parse(form.get("payload") as string)).toEqual({ a: 1 });
    const file = form.get("cprImage") as File;
    expect(file.name).toBe("cpr.jpg");
    expect(file.type).toBe("image/jpeg");
    expect(Buffer.from(await file.arrayBuffer()).equals(image)).toBe(true);
    const none = buildMultipart({ a: 1 }, null);
    const form2 = await new Request("http://x/", { method: "POST", headers: { "content-type": none.contentType }, body: new Uint8Array(none.body) }).formData();
    expect(form2.get("cprImage")).toBeNull();
  });
});

describe("classifyResponse and emailOutcome", () => {
  it("maps every category", () => {
    const c = classifyResponse;
    expect(c({ status: 200, json: { ok: true } })).toBe("ok");
    expect(c({ status: 429, json: { error: "rate_limited" } })).toBe("rate_limited");
    expect(c({ status: 409, json: { error: "duplicate_cpr" } })).toBe("duplicate_cpr");
    expect(c({ status: 409, json: { error: "slot_full" } })).toBe("slot_full");
    expect(c({ status: 409, json: { error: "slot_unavailable" } })).toBe("slot_unavailable");
    expect(c({ status: 403, json: { error: "registration_closed" } })).toBe("registration_closed");
    expect(c({ status: 400, json: { error: "validation" } })).toBe("validation");
    expect(c({ status: 403, json: { error: "turnstile" } })).toBe("turnstile");
    expect(c({ status: 413, json: { error: "too_large" } })).toBe("too_large");
    expect(c({ status: 500, json: { error: "server" } })).toBe("server");
    expect(c({ status: 503, json: null })).toBe("server");
    expect(c({ timedOut: true })).toBe("timeout");
    expect(c({ networkError: true })).toBe("network");
    expect(c({ status: 418, json: null })).toBe("unexpected");
    expect(c({ status: 200, json: { ok: false } })).toBe("unexpected");
  });
  it("classifyResponse edge cases", () => {
    expect(classifyResponse({ timedOut: true, status: 200, json: { ok: true } })).toBe("timeout");
    expect(classifyResponse({ status: 403, json: { error: "other" } })).toBe("unexpected");
    expect(classifyResponse({ status: 409, json: null })).toBe("unexpected");
    expect(classifyResponse({ status: 429, json: null })).toBe("rate_limited");
  });
  it("emailOutcome edge cases", () => {
    expect(emailOutcome({ email: "a@b.co", email_sent: true, email_last_error: "old" })).toBe("sent");
    expect(emailOutcome({ email: "a@b.co", email_sent: false, email_last_error: "" })).toBe("failed");
    expect(emailOutcome({ email: "", email_sent: false })).toBe("none");
  });
  it("emailOutcome", () => {
    expect(emailOutcome({ email: "a@b.co", email_sent: true, email_last_error: null })).toBe("sent");
    expect(emailOutcome({ email: "a@b.co", email_sent: false, email_last_error: "boom" })).toBe("failed");
    expect(emailOutcome({ email: "a@b.co", email_sent: false, email_last_error: null })).toBe("queued");
    expect(emailOutcome({ email: null, email_sent: false, email_last_error: null })).toBe("none");
  });
});

describe("percentile and summarise", () => {
  it("handles empty and single values", () => {
    expect(summarise([])).toEqual({ count: 0, mean: null, p50: null, p95: null, p99: null, max: null });
    expect(percentile([], 50)).toBeNull();
    expect(summarise([7])).toEqual({ count: 1, mean: 7, p50: 7, p95: 7, p99: 7, max: 7 });
  });
  it("uses nearest rank on 1..100", () => {
    const v = Array.from({ length: 100 }, (_, i) => 100 - i);
    expect(summarise(v)).toEqual({ count: 100, mean: 50.5, p50: 50, p95: 95, p99: 99, max: 100 });
    expect(v[0]).toBe(100); // not sorted in place
  });
});

describe("checkQueue", () => {
  it("accepts a contiguous run", () => {
    expect(checkQueue({ numbers: [4, 5, 6], counterBefore: 3, queueStart: 1, counterAfter: 6 })).toMatchObject({ ok: true, expectedStart: 4, expectedEnd: 6 });
  });
  it("reports a gap, a duplicate and a counter mismatch", () => {
    expect(checkQueue({ numbers: [4, 6, 7], counterBefore: 3, queueStart: 1, counterAfter: 7 })).toMatchObject({ ok: false, missing: [5], extra: [7] });
    expect(checkQueue({ numbers: [4, 4, 5], counterBefore: 3, queueStart: 1, counterAfter: 6 })).toMatchObject({ ok: false, duplicates: [4] });
    expect(checkQueue({ numbers: [4, 5, 6], counterBefore: 3, queueStart: 1, counterAfter: 9 }).ok).toBe(false);
  });
  it("starts at queueStart when it is higher", () => {
    expect(checkQueue({ numbers: [100, 101], counterBefore: 3, queueStart: 100, counterAfter: 101 })).toMatchObject({ ok: true, expectedStart: 100 });
  });
});

describe("planSlots", () => {
  const av = [
    { id: 1, capacity: 10, booked: 0, active: true },
    { id: 2, capacity: 10, booked: 0, active: true },
    { id: 3, capacity: 5, booked: 5, active: true },
    { id: 4, capacity: 50, booked: 0, active: false },
  ];
  it("uses the most free room first, ties by lowest id, skipping full and inactive slots", () => {
    const p = planSlots(av, 4, 0)!;
    expect(p.assignments).toEqual([1, 2, 1, 2]);
    expect(p.heldPerSlot.get(1)).toBe(2);
    expect(p.heldPerSlot.has(3)).toBe(false);
    expect(p.heldPerSlot.has(4)).toBe(false);
    expect(p.freeAfter).toBe(16);
    expect(planSlots([{ id: 1, capacity: 10, booked: 0, active: true }, { id: 2, capacity: 14, booked: 0, active: true }], 3, 0)!.assignments).toEqual([2, 2, 2]);
  });
  it("handles zero count, an empty list and exact reserve", () => {
    expect(planSlots(av, 0, 0)).toMatchObject({ assignments: [], freeAfter: 20 });
    expect(planSlots([], 1, 0)).toBeNull();
    expect(planSlots(av, 20, 0)).not.toBeNull();
    expect(planSlots(av, 20, 1)).toBeNull();
  });
  it("returns null when the reserve is not met", () => {
    expect(planSlots(av, 5, 16)).toBeNull();
    expect(planSlots(av, 4, 16)).not.toBeNull();
    expect(planSlots(av, 21, 0)).toBeNull();
  });
});

describe("isWalkInNow", () => {
  it("matches isWalkInMode around the Bahrain day boundary and the start time", () => {
    const event = { event_date: "2026-10-10", event_start_time: "08:30:00" };
    const times = [
      "2026-10-09T20:59:00Z", // 23:59 Bahrain on the 9th
      "2026-10-09T21:00:00Z", // 00:00 on the 10th
      "2026-10-10T05:29:00Z", // 08:29
      "2026-10-10T05:30:00Z", // 08:30
      "2026-10-10T20:59:00Z", // 23:59 on the 10th
      "2026-10-10T21:00:00Z", // 00:00 on the 11th
    ];
    const expected = [false, false, false, true, true, false];
    times.forEach((t, i) => {
      expect(isWalkInNow(event, new Date(t))).toBe(isWalkInMode(event, new Date(t)));
      expect(isWalkInNow(event, new Date(t))).toBe(expected[i]);
    });
    expect(isWalkInNow({ event_date: "2026-10-10" }, new Date("2026-10-10T10:00:00Z"))).toBe(false);
  });
});

describe("rateLimitKey and syntheticIp", () => {
  it("builds a deterministic key", () => {
    expect(rateLimitKey("salt", "1.2.3.4")).toMatch(/^signup:[0-9a-f]{64}$/);
    expect(rateLimitKey("salt", "1.2.3.4")).toBe(rateLimitKey("salt", "1.2.3.4"));
    expect(rateLimitKey("salt", "1.2.3.4")).not.toBe(rateLimitKey("salt2", "1.2.3.4"));
  });
  it("makes unique documentation-range IPs", () => {
    expect(syntheticIp("ab12", 0)).toBe("2001:db8:ab12::1");
    expect(syntheticIp("ab12", 255)).toBe("2001:db8:ab12::100");
    expect(new Set(Array.from({ length: 500 }, (_, i) => syntheticIp("ab12", i))).size).toBe(500);
  });
});

describe("verdict", () => {
  it("fails if any check failed", () => {
    expect(verdict([{ ok: true }, { ok: true }])).toBe("PASS");
    expect(verdict([{ ok: true }, { ok: false }])).toBe("FAIL");
  });
});

describe("pendingEmailCount", () => {
  it("counts only rows that still wait for their email", () => {
    const rows = [
      { email: "a@b.co", email_sent: true, email_last_error: null },
      { email: "c@d.co", email_sent: false, email_last_error: null },
      { email: "e@f.co", email_sent: false, email_last_error: "boom" },
      { email: "g@h.co", email_sent: false, email_last_error: null },
    ];
    expect(pendingEmailCount(rows)).toBe(2);
  });
  it("is 0 for an empty list", () => {
    expect(pendingEmailCount([])).toBe(0);
  });
  it("does not count rows without an email", () => {
    expect(pendingEmailCount([{ email: null, email_sent: false, email_last_error: null }, { email: "", email_sent: false }])).toBe(0);
  });
});
