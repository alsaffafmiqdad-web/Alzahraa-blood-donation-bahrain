// Pure helpers for the load test (scripts/loadtest/run.mjs). No network, no env reads, no file access,
// so Vitest can import this file (tests/unit/loadtest-lib.test.ts). Plain ESM with JSDoc types, because
// the script runs under plain `node` and cannot import lib/*.ts with the "@/" aliases.
import { createHash, randomBytes, randomUUID } from "node:crypto";

/**
 * Exactly the keys in .env.example (a test asserts it). The child processes get every one of them set,
 * even to "", so @next/env never fills a gap from .env.local.
 */
export const APP_ENV_KEYS = [
  "NEXT_PUBLIC_SITE_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "EMAIL_PROVIDER",
  "GMAIL_USER",
  "GMAIL_APP_PASSWORD",
  "GMAIL_FROM_NAME",
  "RESEND_API_KEY",
  "RESEND_FROM_EMAIL",
  "EMAIL_DAILY_BUDGET",
  "DISCORD_WEBHOOK_URL",
  "NEXT_PUBLIC_TURNSTILE_SITE_KEY",
  "TURNSTILE_SECRET_KEY",
  "CRON_SECRET",
  "RATE_LIMIT_SALT",
  "NEXT_PUBLIC_ORG_NAME",
  "NEXT_PUBLIC_ORG_CONTACT_EMAIL",
  "NEXT_PUBLIC_ORG_CONTACT_PHONE",
];

/** Variables that must be set in both targets. */
export const REQUIRED_ENV_KEYS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "RATE_LIMIT_SALT",
  "CRON_SECRET",
];

/** Must equal SIGNUP_RATE_LIMIT.limit in lib/config.ts (a test asserts it). */
export const RATE_LIMIT = 25;
/** Must equal GMAIL_DEFAULT_BUDGET in lib/config.ts (a test asserts it). */
export const GMAIL_DEFAULT_BUDGET = 450;
/** Copy of BLOOD_TYPES in lib/config.ts (a test asserts it). */
export const BLOOD_TYPES = ["unknown", "A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];

/** Cloudflare's documented test secret: always passes. */
export const TURNSTILE_TEST_SECRET = "1x0000000000000000000000000000000AA";
/** The signup route's maxDuration (app/api/signup/route.ts); a test asserts they match. */
export const LATENCY_HARD_LIMIT_MS = 60_000;

export const USAGE = `Usage: pnpm loadtest [options]
  --target <local|production>   default local
  --env-file <path>             production only: git-ignored env file inside the repository
  --email-base <addr>           production only: your own address; sends go to <local>+lt-<tag>-<n>@<domain>
  --yes                         production only: skip the typed confirmation
  --users <n>                   1..500, default 50
  --dup <n>                     2..50, default 10
  --replay <n>                  2..20, default 5
  --rate-limit-requests <n>     26..100, default 30 (local only)
  --image-bytes <n>             1024..2000000, default 500000
  --mode <slot|walk-in|both>    default both (local only; production is always slot)
  --port <n>                    1024..65535, default 3100
  --p95-budget-ms <n>           default 10000
  --timeout-ms <n>              default 65000
  --max-emails <n>              1..450, default 80 (production only)
  --reserve-places <n>          default 25
  --skip-rate-limit-check       local only
  --no-card
  --keep                        local only
  --cleanup-only
`;

const INT_RANGES = {
  "--users": ["users", 1, 500],
  "--dup": ["dup", 2, 50],
  "--replay": ["replay", 2, 20],
  "--rate-limit-requests": ["rateLimitRequests", 26, 100],
  "--image-bytes": ["imageBytes", 1024, 2_000_000],
  "--port": ["port", 1024, 65535],
  "--p95-budget-ms": ["p95BudgetMs", 1, Number.MAX_SAFE_INTEGER],
  "--timeout-ms": ["timeoutMs", 1, Number.MAX_SAFE_INTEGER],
  "--max-emails": ["maxEmails", 1, 450],
  "--reserve-places": ["reservePlaces", 0, Number.MAX_SAFE_INTEGER],
};
const BOOLEANS = {
  "--yes": "yes",
  "--skip-rate-limit-check": "skipRateLimitCheck",
  "--no-card": "noCard",
  "--keep": "keep",
  "--cleanup-only": "cleanupOnly",
};
const STRINGS = {
  "--target": "target",
  "--env-file": "envFile",
  "--email-base": "emailBase",
  "--mode": "mode",
};

/** @typedef {{ target: "local"|"production", envFile: string|null, emailBase: string|null, yes: boolean, users: number, dup: number, replay: number, rateLimitRequests: number, imageBytes: number, mode: "slot"|"walk-in"|"both", port: number, p95BudgetMs: number, timeoutMs: number, maxEmails: number, reservePlaces: number, skipRateLimitCheck: boolean, noCard: boolean, keep: boolean, cleanupOnly: boolean }} Options */

/**
 * Parses the command line (without node and the script path).
 * @param {string[]} argv
 * @returns {{ ok: true, options: Options } | { ok: false, error: string }}
 */
export function parseArgs(argv) {
  /** @type {Options} */
  const o = {
    target: "local",
    envFile: null,
    emailBase: null,
    yes: false,
    users: 50,
    dup: 10,
    replay: 5,
    rateLimitRequests: 30,
    imageBytes: 500_000,
    mode: "both",
    port: 3100,
    p95BudgetMs: 10_000,
    timeoutMs: 65_000,
    maxEmails: 80,
    reservePlaces: 25,
    skipRateLimitCheck: false,
    noCard: false,
    keep: false,
    cleanupOnly: false,
  };
  const seen = new Set();
  const args = [...argv];
  while (args.length) {
    let flag = /** @type {string} */ (args.shift());
    let inline = null;
    const eq = flag.indexOf("=");
    if (flag.startsWith("--") && eq > 0) {
      inline = flag.slice(eq + 1);
      flag = flag.slice(0, eq);
    }
    if (flag in BOOLEANS) {
      if (inline !== null) return { ok: false, error: `${flag} does not take a value` };
      // @ts-expect-error dynamic key
      o[BOOLEANS[flag]] = true;
      seen.add(flag);
      continue;
    }
    if (flag in INT_RANGES || flag in STRINGS) {
      const value = inline ?? args.shift();
      if (value === undefined || (inline === null && value.startsWith("--"))) {
        return { ok: false, error: `${flag} needs a value` };
      }
      seen.add(flag);
      if (flag in INT_RANGES) {
        const [key, min, max] = INT_RANGES[/** @type {keyof typeof INT_RANGES} */ (flag)];
        if (!/^\d+$/.test(value) || Number(value) < min || Number(value) > max) {
          const range = max === Number.MAX_SAFE_INTEGER ? `at least ${min}` : `${min} to ${max}`;
          return { ok: false, error: `${flag} must be a whole number, ${range}` };
        }
        // @ts-expect-error dynamic key
        o[key] = Number(value);
      } else {
        // @ts-expect-error dynamic key
        o[STRINGS[flag]] = value;
      }
      continue;
    }
    return { ok: false, error: `Unknown option: ${flag}` };
  }
  if (o.target !== "local" && o.target !== "production") {
    return { ok: false, error: "--target must be local or production" };
  }
  if (!["slot", "walk-in", "both"].includes(o.mode)) {
    return { ok: false, error: "--mode must be slot, walk-in or both" };
  }
  if (o.emailBase !== null && !/^[^\s@+]+@[^\s@]+\.[A-Za-z]{2,}$/.test(o.emailBase)) {
    return { ok: false, error: "--email-base must look like name@domain.tld, with no + in the name" };
  }
  if (o.target === "production") {
    if (!o.envFile) return { ok: false, error: "--target production needs --env-file <path>" };
    // Cleanup sends no email, so it does not need an address.
    if (!o.emailBase && !o.cleanupOnly) return { ok: false, error: "--target production needs --email-base <your address>" };
    if (seen.has("--mode") && o.mode !== "slot") {
      return { ok: false, error: "production runs in slot mode only; --mode walk-in and both are not allowed" };
    }
    if (o.keep) return { ok: false, error: "--keep is not allowed with --target production" };
    o.mode = "slot";
  } else {
    if (o.envFile !== null) return { ok: false, error: "--env-file is only for --target production" };
    if (o.emailBase !== null) return { ok: false, error: "--email-base is only for --target production" };
  }
  return { ok: true, options: o };
}

/**
 * Parses KEY=value lines. Blank lines and # comments are skipped; single or double quotes around a value are removed.
 * @param {string} text
 * @returns {Record<string, string>}
 */
export function parseEnvFile(text) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/.exec(line);
    if (!m) continue;
    let value = (m[2] ?? "").trim();
    if (value.length >= 2 && (value[0] === '"' || value[0] === "'") && value.endsWith(value[0])) {
      value = value.slice(1, -1);
    }
    out[/** @type {string} */ (m[1])] = value;
  }
  return out;
}

/**
 * The environment for `next build` and `next start`: every app key is set (even to ""), so nothing is read from .env.local.
 * @param {Record<string, string|undefined>} processEnv
 * @param {Record<string, string|undefined>} targetEnv
 * @param {"local"|"production"} target
 * @returns {Record<string, string>}
 */
export function buildChildEnv(processEnv, targetEnv, target) {
  /** @type {Record<string, string>} */
  const env = {};
  for (const [k, v] of Object.entries(processEnv)) {
    if (v !== undefined && !APP_ENV_KEYS.includes(k) && k !== "VERCEL_ENV") env[k] = v;
  }
  for (const k of APP_ENV_KEYS) env[k] = targetEnv[k] ?? "";
  env.DISCORD_WEBHOOK_URL = "";
  env.TURNSTILE_SECRET_KEY = TURNSTILE_TEST_SECRET;
  if (target === "local") {
    env.EMAIL_PROVIDER = "";
    env.GMAIL_USER = "";
    env.GMAIL_APP_PASSWORD = "";
    env.RESEND_API_KEY = "";
    env.RESEND_FROM_EMAIL = "";
  }
  return env;
}

/* ---------- Bahrain time (same rules as lib/format.ts and lib/event-mode.ts) ---------- */

const TZ = "Asia/Bahrain";

/** @param {Date} [now] */
export function bahrainDate(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: TZ }).format(now);
}

/** @param {Date} [now] */
export function bahrainClock(now = new Date()) {
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: TZ }).format(now);
}

/**
 * @param {string} isoDate YYYY-MM-DD
 * @param {number} days
 */
export function addDays(isoDate, days) {
  const [y = 1970, m = 1, d = 1] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/**
 * Same rule as isWalkInMode in lib/event-mode.ts.
 * @param {{ event_date: string, event_start_time?: string|null }} event
 * @param {Date} [now]
 */
export function isWalkInNow(event, now = new Date()) {
  const start = event.event_start_time;
  if (typeof start !== "string" || !/^\d{2}:\d{2}/.test(start)) return false;
  return bahrainDate(now) === event.event_date && bahrainClock(now) >= start.slice(0, 5);
}

/**
 * Minutes from now until the event start time today in Bahrain, or null when the event is not today or has started.
 * @param {{ event_date: string, event_start_time?: string|null }} event
 * @param {Date} [now]
 */
export function minutesToWalkIn(event, now = new Date()) {
  const start = event.event_start_time;
  if (typeof start !== "string" || !/^\d{2}:\d{2}/.test(start)) return null;
  if (bahrainDate(now) !== event.event_date) return null;
  const toMin = (/** @type {string} */ s) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
  const diff = toMin(start) - toMin(bahrainClock(now));
  return diff > 0 ? diff : null;
}

/* ---------- Synthetic data ---------- */

/** @param {number} i integer 0..99999 */
export function syntheticCpr(i) {
  if (!Number.isInteger(i) || i < 0 || i > 99999) throw new Error("syntheticCpr: index out of range");
  return "9900" + String(i).padStart(5, "0");
}

/** @param {string} s */
export function isLoadtestCpr(s) {
  return /^9900\d{5}$/.test(s);
}

/**
 * @param {number} i
 * @param {{ emailBase?: string|null, runTag?: string }} [opts]
 */
export function syntheticEmail(i, { emailBase, runTag = "" } = {}) {
  if (!emailBase) return `loadtest-${i}@example.invalid`;
  const at = emailBase.lastIndexOf("@");
  return `${emailBase.slice(0, at)}+lt-${runTag}-${i}@${emailBase.slice(at + 1)}`;
}

/**
 * Index as lowercase letters (0 -> "a", 25 -> "z", 26 -> "ba"), because names may not contain digits.
 * @param {number} i
 * @returns {string}
 */
export function letterIndex(i) {
  let n = i;
  let out = "";
  do {
    out = String.fromCharCode(97 + (n % 26)) + out;
    n = Math.floor(n / 26);
  } while (n > 0);
  return out;
}

/**
 * The payload the signup form sends (components/public/SignupForm.tsx).
 * @param {number} i
 * @param {{ slotId?: number|null, walkIn?: boolean, emailBase?: string|null, runTag?: string }} [opts]
 */
export function syntheticDonor(i, { slotId = null, walkIn = false, emailBase = null, runTag = "" } = {}) {
  /** @type {Record<string, unknown>} */
  const donor = {
    fullName: `Loadtest Donor ${letterIndex(i)}`,
    cpr: syntheticCpr(i),
    dob: "1990-01-01",
    phone: "3" + String(i).padStart(7, "0"),
    email: syntheticEmail(i, { emailBase, runTag }),
    bloodType: BLOOD_TYPES[i % BLOOD_TYPES.length],
    recentDonation: false,
    onMedication: i % 7 === 0,
    consent: true,
    token: "XXXX.DUMMY.TOKEN.XXXX",
    submissionId: randomUUID(),
  };
  if (!walkIn) donor.slotId = slotId;
  return donor;
}

/** @param {number} seed */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A byte string that sniffs as a JPEG: SOI, JFIF header, COM segments of seeded noise, EOI. Not a decodable picture.
 * @param {number} size exact length in bytes
 * @param {number} seed
 * @returns {Buffer}
 */
export function syntheticJpeg(size, seed) {
  const head = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00];
  if (!Number.isInteger(size) || size < head.length + 2 + 4) throw new Error("syntheticJpeg: size too small");
  const out = Buffer.alloc(size);
  Buffer.from(head).copy(out, 0);
  const rand = mulberry32(seed);
  let pos = head.length;
  let rem = size - head.length - 2;
  while (rem > 0) {
    let seg = Math.min(rem, 65537); // marker (2) + length (2) + up to 65533 data bytes
    if (rem - seg > 0 && rem - seg < 4) seg = rem - 4;
    out[pos++] = 0xff;
    out[pos++] = 0xfe;
    out.writeUInt16BE(seg - 2, pos);
    pos += 2;
    for (let k = 0; k < seg - 4; k++) out[pos++] = (rand() * 256) | 0;
    rem -= seg;
  }
  out[pos++] = 0xff;
  out[pos++] = 0xd9;
  return out;
}

/**
 * Builds a multipart body by hand, so the request has a Content-Length (as tests/helpers/multipart.ts).
 * @param {unknown} payload
 * @param {Uint8Array|null} image
 * @returns {{ body: Buffer, contentType: string }}
 */
export function buildMultipart(payload, image) {
  const boundary = "----loadtest" + randomBytes(12).toString("hex");
  const parts = [
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="payload"\r\n\r\n${
        typeof payload === "string" ? payload : JSON.stringify(payload)
      }\r\n`,
    ),
  ];
  if (image) {
    parts.push(
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="cprImage"; filename="cpr.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`),
      Buffer.from(image),
      Buffer.from("\r\n"),
    );
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` };
}

/**
 * One address per virtual user (documentation range 2001:db8::/32).
 * @param {string} runTag 4 hex characters
 * @param {number} i
 */
export function syntheticIp(runTag, i) {
  return `2001:db8:${runTag}::${(i + 1).toString(16)}`;
}

/** @returns {string} 4 random hex characters */
export function newRunTag() {
  return randomBytes(2).toString("hex");
}

/**
 * Must match signupKey in lib/rate-limit.ts.
 * @param {string} salt
 * @param {string} ip
 */
export function rateLimitKey(salt, ip) {
  return "signup:" + createHash("sha256").update(salt + ip).digest("hex");
}

/* ---------- Slot planning ---------- */

/**
 * @param {{ id: number, capacity: number, booked: number, active: boolean }[]} availability
 * @param {number} count
 * @param {number} reservePlaces
 * @returns {{ assignments: number[], heldPerSlot: Map<number, number>, freeAfter: number } | null}
 */
export function planSlots(availability, count, reservePlaces) {
  const free = new Map();
  for (const s of availability) {
    const room = s.capacity - s.booked;
    if (s.active && room > 0) free.set(s.id, room);
  }
  let total = 0;
  for (const v of free.values()) total += v;
  if (total - count < reservePlaces) return null;
  /** @type {number[]} */
  const assignments = [];
  /** @type {Map<number, number>} */
  const heldPerSlot = new Map();
  for (let n = 0; n < count; n++) {
    let best = null;
    for (const [id, room] of free) {
      if (room <= 0) continue;
      if (best === null || room > (free.get(best) ?? 0) || (room === free.get(best) && id < best)) best = id;
    }
    if (best === null) return null;
    free.set(best, (free.get(best) ?? 0) - 1);
    heldPerSlot.set(best, (heldPerSlot.get(best) ?? 0) + 1);
    assignments.push(best);
  }
  return { assignments, heldPerSlot, freeAfter: total - count };
}

/* ---------- Classification and metrics ---------- */

export const CATEGORY_HINTS = {
  turnstile: "Cloudflare unreachable (the test needs internet access for Turnstile)",
  rate_limited: "x-real-ip simulation not honoured; all users shared one rate-limit key",
};

/**
 * @param {{ status?: number, json?: any, networkError?: boolean, timedOut?: boolean }} r
 * @returns {"ok"|"rate_limited"|"duplicate_cpr"|"slot_full"|"slot_unavailable"|"registration_closed"|"validation"|"turnstile"|"too_large"|"server"|"timeout"|"network"|"unexpected"}
 */
export function classifyResponse({ status, json, networkError, timedOut }) {
  if (timedOut) return "timeout";
  if (networkError) return "network";
  if (status === 200 && json && json.ok === true) return "ok";
  if (status === 429) return "rate_limited";
  if (status === 400) return "validation";
  if (status === 413) return "too_large";
  if (typeof status === "number" && status >= 500) return "server";
  const code = json && typeof json.error === "string" ? json.error : "";
  if (status === 403 && code === "turnstile") return "turnstile";
  if (code === "duplicate_cpr" || code === "slot_full" || code === "slot_unavailable" || code === "registration_closed") {
    return code;
  }
  return "unexpected";
}

/**
 * Nearest-rank percentile.
 * @param {number[]} values
 * @param {number} p 0..100
 * @returns {number|null}
 */
export function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return /** @type {number} */ (sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)]);
}

/** @param {number[]} latenciesMs */
export function summarise(latenciesMs) {
  const n = latenciesMs.length;
  if (!n) return { count: 0, mean: null, p50: null, p95: null, p99: null, max: null };
  return {
    count: n,
    mean: latenciesMs.reduce((a, b) => a + b, 0) / n,
    p50: percentile(latenciesMs, 50),
    p95: percentile(latenciesMs, 95),
    p99: percentile(latenciesMs, 99),
    max: Math.max(...latenciesMs),
  };
}

/**
 * @param {{ email?: string|null, email_sent?: boolean|null, email_last_error?: string|null }} row
 * @returns {"sent"|"failed"|"queued"|"none"}
 */
export function emailOutcome(row) {
  if (row.email_sent) return "sent";
  if (row.email_last_error !== null && row.email_last_error !== undefined) return "failed";
  if (row.email) return "queued";
  return "none";
}

export const EMAIL_SETTLE_MS = 90_000;
export const EMAIL_POLL_MS = 3_000;

/**
 * How many rows still wait for their email (outcome "queued").
 * @param {{ email?: string|null, email_sent?: boolean|null, email_last_error?: string|null }[]} rows
 * @returns {number}
 */
export function pendingEmailCount(rows) {
  return rows.filter((row) => emailOutcome(row) === "queued").length;
}

/**
 * @param {{ numbers: number[], counterBefore: number, queueStart: number, counterAfter: number }} a
 */
export function checkQueue({ numbers, counterBefore, queueStart, counterAfter }) {
  const expectedStart = Math.max(counterBefore + 1, queueStart);
  const expectedEnd = expectedStart + numbers.length - 1;
  const seen = new Set();
  const dupSet = new Set();
  for (const n of numbers) {
    if (seen.has(n)) dupSet.add(n);
    seen.add(n);
  }
  const missing = [];
  for (let n = expectedStart; n <= expectedEnd; n++) if (!seen.has(n)) missing.push(n);
  const extra = [...seen].filter((n) => n < expectedStart || n > expectedEnd);
  const duplicates = [...dupSet];
  const ok = !duplicates.length && !missing.length && !extra.length && counterAfter === expectedEnd;
  return { ok, expectedStart, expectedEnd, duplicates, missing, extra };
}

/** @param {{ ok: boolean }[]} checks */
export function verdict(checks) {
  return checks.some((c) => !c.ok) ? "FAIL" : "PASS";
}
