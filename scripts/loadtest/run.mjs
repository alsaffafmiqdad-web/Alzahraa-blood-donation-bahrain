// Load test for the signup path: page load, multipart POST /api/signup with a CPR photo, the DB,
// Storage, email (production target only) and the PDF from POST /api/card.
//   pnpm build && pnpm loadtest                       (local target, the default)
//   pnpm loadtest --target production --env-file .env.loadtest-production --email-base <you@gmail.com>
//   pnpm loadtest:cleanup
// See docs/operations.md, "Load testing". All data is synthetic; nothing personal is printed or written.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { isLocalUrl } from "../create-local-admin.mjs";
import {
  CATEGORY_HINTS,
  GMAIL_DEFAULT_BUDGET,
  LATENCY_HARD_LIMIT_MS,
  RATE_LIMIT,
  REQUIRED_ENV_KEYS,
  USAGE,
  addDays,
  bahrainClock,
  bahrainDate,
  buildChildEnv,
  buildMultipart,
  checkQueue,
  classifyResponse,
  emailOutcome,
  EMAIL_POLL_MS,
  EMAIL_SETTLE_MS,
  pendingEmailCount,
  isWalkInNow,
  minutesToWalkIn,
  newRunTag,
  parseArgs,
  parseEnvFile,
  planSlots,
  rateLimitKey,
  summarise,
  syntheticDonor,
  syntheticIp,
  syntheticJpeg,
  verdict,
} from "./lib.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const LT_DIR = path.join(REPO, ".loadtest");
const STATE_PATH = path.join(LT_DIR, "state.json");
const REPORT_PATH = path.join(LT_DIR, "report.json");
const LOG_PATH = path.join(LT_DIR, "server.log");
const BUILD_MARK = path.join(LT_DIR, "production-build-id");
const NEXT_BIN = path.join(REPO, "node_modules/next/dist/bin/next");

/**
 * Deletes `.next/BUILD_ID` so a build with the production NEXT_PUBLIC_* values baked in can't be
 * served by a plain `next start` later: it fails loudly and asks for `pnpm build` instead.
 */
function discardProductionBuild() {
  for (const p of [path.join(REPO, ".next/BUILD_ID"), BUILD_MARK]) {
    try {
      fs.rmSync(p, { force: true });
    } catch {
      /* best effort: the local guard still refuses a marked build */
    }
  }
}
const BUCKET = "cpr-images";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MARKER_CPR = "9900%";
const MARKER_NAME = "Loadtest Donor %";

class ExitError extends Error {
  /** @param {number} code @param {string} message */
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}
/** @param {string} message */
const config = (message) => new ExitError(2, message);

/** @type {import("node:child_process").ChildProcess | null} */
let serverChild = null;
process.on("exit", () => {
  try {
    serverChild?.kill("SIGKILL");
  } catch {
    /* already gone */
  }
});

/* ---------------- small helpers ---------------- */

const ms = (/** @type {number|null} */ v) => (v === null || v === undefined ? "-" : String(Math.round(v)));
const pad = (/** @type {unknown} */ s, /** @type {number} */ n) => String(s).padEnd(n);
const sleep = (/** @type {number} */ t) => new Promise((r) => setTimeout(r, t));

/**
 * @template T, R
 * @param {T[]} items
 * @param {number} limit
 * @param {(item: T, i: number) => Promise<R>} fn
 * @returns {Promise<R[]>}
 */
async function pool(items, limit, fn) {
  /** @type {R[]} */
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const k = next++;
        out[k] = await fn(/** @type {T} */ (items[k]), k);
      }
    }),
  );
  return out;
}

/** @template T @param {T[]} arr @param {number} n */
function chunks(arr, n) {
  /** @type {T[][]} */
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

/** @param {{ error: { message: string } | null }} res @param {string} what */
function must(res, what) {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res;
}

/** @param {string[]} values */
function countBy(values) {
  /** @type {Record<string, number>} */
  const out = {};
  for (const v of values) out[v] = (out[v] ?? 0) + 1;
  return out;
}

/* ---------------- environment ---------------- */

/**
 * @param {import("./lib.mjs").Options} opts
 * @returns {{ targetEnv: Record<string, string|undefined>, url: string, host: string, salt: string }}
 */
function resolveTargetEnv(opts) {
  /** @type {Record<string, string|undefined>} */
  let targetEnv;
  if (opts.target === "local") {
    targetEnv = process.env;
    if (!isLocalUrl(targetEnv.NEXT_PUBLIC_SUPABASE_URL ?? "")) {
      console.error(
        "Refusing to run: NEXT_PUBLIC_SUPABASE_URL is not localhost or 127.0.0.1.\n" +
          "The local target only runs against the local Supabase stack (pnpm dlx supabase start).",
      );
      process.exit(2);
    }
  } else {
    const file = path.resolve(REPO, /** @type {string} */ (opts.envFile));
    const notOk = "the env file must be a git-ignored file inside the repository";
    let real;
    try {
      real = fs.realpathSync(file);
    } catch {
      throw config(`${notOk} (file not found)`);
    }
    const rel = path.relative(fs.realpathSync(REPO), real);
    if (rel.startsWith("..") || path.isAbsolute(rel) || !fs.statSync(real).isFile()) throw config(notOk);
    const ignored = spawnSync("git", ["check-ignore", "-q", real], { cwd: REPO });
    if (ignored.status !== 0) throw config(notOk);
    targetEnv = parseEnvFile(fs.readFileSync(real, "utf8"));
  }
  const missing = REQUIRED_ENV_KEYS.filter((k) => !targetEnv[k]);
  if (missing.length) throw config(`Missing required variables: ${missing.join(", ")}`);
  const url = /** @type {string} */ (targetEnv.NEXT_PUBLIC_SUPABASE_URL);
  if (opts.target === "production") {
    if (isLocalUrl(url)) {
      throw config("NEXT_PUBLIC_SUPABASE_URL in the env file is local; use the local target (no --target production).");
    }
    const provider = targetEnv.EMAIL_PROVIDER ?? "";
    if (!targetEnv.GMAIL_USER || !targetEnv.GMAIL_APP_PASSWORD || (provider !== "" && provider !== "gmail")) {
      throw config("The Gmail config is incomplete: set GMAIL_USER and GMAIL_APP_PASSWORD, and leave EMAIL_PROVIDER empty or gmail.");
    }
  }
  let host;
  try {
    host = new URL(url).host;
  } catch {
    throw config("NEXT_PUBLIC_SUPABASE_URL is not a valid URL");
  }
  return { targetEnv, url, host, salt: /** @type {string} */ (targetEnv.RATE_LIMIT_SALT) };
}

/* ---------------- state ---------------- */

/** @typedef {{ runTag: string, ipCount: number, target: string, supabaseHost: string, envFile: string|null, startedAt: string, event: null | { event_date: string, event_start_time: string, public_registration_open: boolean, queue_counter: number } }} State */

/** @returns {State|null} */
function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
  } catch {
    return null;
  }
}
/** @param {State} state */
function writeState(state) {
  fs.mkdirSync(LT_DIR, { recursive: true });
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

/* ---------------- database helpers ---------------- */

/** @typedef {ReturnType<typeof createClient>} Db */

/**
 * Every marker donor: cpr like '9900%' AND full_name like 'Loadtest Donor %'. Paged, as lib/db/paginate.ts.
 * @param {Db} db
 * @param {string} cols
 * @returns {Promise<any[]>}
 */
async function loadMarkerDonors(db, cols) {
  const all = [];
  for (let from = 0; ; from += 1000) {
    const res = must(
      await db.from("donors").select(cols).like("cpr", MARKER_CPR).like("full_name", MARKER_NAME).order("id").range(from, from + 999),
      "load donors",
    );
    const rows = /** @type {any[]} */ (res.data ?? []);
    all.push(...rows);
    if (rows.length < 1000) break;
  }
  return all;
}

/** @param {Db} db */
async function readEvent(db) {
  const res = must(
    await db.from("event").select("event_date, event_start_time, public_registration_open, queue_counter, queue_start").single(),
    "read event",
  );
  return /** @type {{ event_date: string, event_start_time: string, public_registration_open: boolean, queue_counter: number, queue_start: number }} */ (res.data);
}

/** @param {Db} db */
async function readAvailability(db) {
  const slots = must(await db.from("slots").select("id, active"), "read slots").data ?? [];
  const activeById = new Map(slots.map((s) => [Number(s.id), Boolean(s.active)]));
  const av = must(await db.rpc("slot_availability"), "slot_availability").data ?? [];
  return /** @type {any[]} */ (av).map((r) => ({
    id: Number(r.id),
    capacity: Number(r.capacity),
    booked: Number(r.booked),
    active: activeById.get(Number(r.id)) === true,
  }));
}

/** @param {Db} db @param {string} id */
async function listFolder(db, id) {
  // Verification reads only: retry a few times, because the Storage API can briefly time out under load.
  let last = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await db.storage.from(BUCKET).list(id, { limit: 1000 });
    if (!res.error) return (res.data ?? []).filter((f) => f.id !== null || f.metadata);
    last = res.error;
    await sleep(500 * (attempt + 1));
  }
  throw new Error(`list photos: ${last?.message ?? "failed"}`);
}

/** Top-level folders in the bucket that are not an existing donor id. @param {Db} db */
async function countOrphanFolders(db) {
  /** @type {string[]} */
  const names = [];
  for (let offset = 0; ; offset += 1000) {
    const res = must(await db.storage.from(BUCKET).list("", { limit: 1000, offset }), "list bucket");
    const page = res.data ?? [];
    names.push(...page.map((f) => f.name).filter((n) => UUID_RE.test(n)));
    if (page.length < 1000) break;
  }
  const existing = new Set();
  for (const part of chunks(names, 100)) {
    const res = must(await db.from("donors").select("id").in("id", part), "check folders");
    for (const r of res.data ?? []) existing.add(r.id);
  }
  return { total: names.length, orphans: names.filter((n) => !existing.has(n)).length };
}

/* ---------------- cleanup ---------------- */

/**
 * @param {{ db: Db, salt: string, state: State|null, target: string }} c
 * @returns {Promise<{ ok: boolean, problems: string[], notes: string[] }>}
 */
async function cleanup({ db, salt, state, target }) {
  /** @type {string[]} */
  const problems = [];
  /** @type {string[]} */
  const notes = [];
  const donors = await loadMarkerDonors(db, "id");
  const ids = donors.map((d) => d.id);

  const paths = (
    await pool(ids, 10, async (id) => (await listFolder(db, id)).map((f) => `${id}/${f.name}`))
  ).flat();
  for (const batch of chunks(paths, 100)) {
    must(await db.storage.from(BUCKET).remove(batch), "remove photos");
  }
  for (const batch of chunks(ids, 100)) {
    must(
      await db.from("donors").delete().in("id", batch).like("cpr", MARKER_CPR).like("full_name", MARKER_NAME),
      "delete donors",
    );
  }
  // email_sends rows are left alone on purpose: they record real sends and keep counting against the 24 h budget.

  /** @type {string[]} */
  let keys = [];
  if (state) {
    for (let i = 0; i < state.ipCount; i++) keys.push(rateLimitKey(salt, syntheticIp(state.runTag, i)));
    for (const batch of chunks(keys, 100)) must(await db.from("rate_limits").delete().in("key", batch), "delete rate limits");
  }

  if (target === "local" && state?.event) {
    const top = must(
      await db.from("donors").select("queue_number").not("queue_number", "is", null).order("queue_number", { ascending: false }).limit(1),
      "read queue",
    ).data ?? [];
    const maxQueue = top[0]?.queue_number ?? null;
    const restore = {
      event_date: state.event.event_date,
      event_start_time: state.event.event_start_time,
      public_registration_open: state.event.public_registration_open,
    };
    if (maxQueue === null || maxQueue <= state.event.queue_counter) {
      must(await db.from("event").update({ ...restore, queue_counter: state.event.queue_counter }).eq("id", true), "restore event");
    } else {
      must(await db.from("event").update(restore).eq("id", true), "restore event");
      notes.push("queue_counter was not restored because other donors hold higher queue numbers");
    }
  }

  // Check: nothing is left.
  const left = await loadMarkerDonors(db, "id");
  if (left.length) problems.push(`${left.length} test donors remain`);
  const folders = await pool(ids, 10, async (id) => (await listFolder(db, id)).length);
  if (folders.some((n) => n > 0)) problems.push(`${folders.filter((n) => n > 0).length} photo folders remain`);
  if (keys.length) {
    let remaining = 0;
    for (const batch of chunks(keys, 100)) {
      remaining += must(await db.from("rate_limits").select("key").in("key", batch), "check rate limits").data?.length ?? 0;
    }
    if (remaining) problems.push(`${remaining} rate limit rows remain`);
  }
  if (!problems.length) {
    try {
      fs.rmSync(STATE_PATH);
    } catch {
      /* no state file */
    }
  }
  return { ok: problems.length === 0, problems, notes };
}

/* ---------------- server ---------------- */

function logTail() {
  try {
    return fs.readFileSync(LOG_PATH, "utf8").split("\n").slice(-40).join("\n");
  } catch {
    return "(no server log)";
  }
}

/**
 * @param {import("./lib.mjs").Options} opts
 * @param {Record<string, string>} childEnv
 */
async function startServer(opts, childEnv) {
  fs.mkdirSync(LT_DIR, { recursive: true });
  const fd = fs.openSync(LOG_PATH, "w");
  serverChild = spawn(process.execPath, [NEXT_BIN, "start", "-p", String(opts.port), "-H", "127.0.0.1"], {
    cwd: REPO,
    env: childEnv,
    stdio: ["ignore", fd, fd],
  });
  let exited = false;
  serverChild.on("exit", () => {
    exited = true;
  });
  const base = `http://127.0.0.1:${opts.port}`;
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (exited) break;
    try {
      const res = await fetch(`${base}/ar/join`, { signal: AbortSignal.timeout(5000) });
      await res.arrayBuffer();
      if (res.status === 200) return base;
    } catch {
      /* not up yet */
    }
    await sleep(500);
  }
  console.error(logTail());
  throw config(exited ? "The server exited before it was ready (see the log above)." : "The server was not ready within 60 s (see the log above).");
}

async function stopServer() {
  const child = serverChild;
  if (!child || child.exitCode !== null) return;
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        /* gone */
      }
    }, 5000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve(undefined);
    });
    child.kill("SIGTERM");
  });
}

/* ---------------- requests ---------------- */

/**
 * @param {string} url
 * @param {RequestInit} init
 * @param {number} timeoutMs
 * @param {boolean} binary
 */
async function timed(url, init, timeoutMs, binary = false) {
  const start = performance.now();
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    let json = null;
    let magic = "";
    if (binary) {
      const buf = Buffer.from(await res.arrayBuffer());
      magic = buf.subarray(0, 5).toString("latin1");
    } else {
      const text = await res.text();
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
    }
    const end = performance.now();
    return {
      status: res.status,
      contentType: res.headers.get("content-type") ?? "",
      json,
      magic,
      networkError: false,
      timedOut: false,
      start,
      end,
      ms: end - start,
    };
  } catch (e) {
    const end = performance.now();
    const name = e && typeof e === "object" && "name" in e ? String(e.name) : "";
    const timedOut = name === "TimeoutError" || name === "AbortError";
    return { status: 0, contentType: "", json: null, magic: "", networkError: !timedOut, timedOut, start, end, ms: end - start };
  }
}

/** @typedef {{ group: string, cpr: string, ip: string, submissionId: string, slotId: number|null, body: Buffer, contentType: string, hasImage: boolean, locale: string }} Req */
/** @typedef {{ req: Req, category: string, status: number, json: any, ms: number, start: number, end: number, cardOk?: boolean, cardNote?: string }} Res */

function stepStats(/** @type {{ category: string, ms: number, start: number, end: number }[]} */ results) {
  const okMs = results.filter((r) => r.category === "ok").map((r) => r.ms);
  const all = summarise(results.map((r) => r.ms));
  const ok = summarise(okMs);
  const span = results.length ? (Math.max(...results.map((r) => r.end)) - Math.min(...results.map((r) => r.start))) / 1000 : 0;
  const throughput = span > 0 ? okMs.length / span : null;
  return { categories: countBy(results.map((r) => r.category)), all, ok, throughput };
}

/* ---------------- main ---------------- */

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if (!parsed.ok) {
    console.error(parsed.error + "\n\n" + USAGE);
    return 2;
  }
  const opts = parsed.options;
  const production = opts.target === "production";
  const { targetEnv, url, host, salt } = resolveTargetEnv(opts);
  const db = createClient(url, /** @type {string} */ (targetEnv.SUPABASE_SERVICE_ROLE_KEY), {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  /** @param {string} what */
  async function confirmHost(what) {
    if (opts.yes) return;
    if (!process.stdin.isTTY) throw config("Not an interactive terminal and --yes is not set; cannot ask for confirmation.");
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await new Promise((resolve) => rl.question(`${what}\nType the Supabase host (${host}) to continue: `, resolve));
    rl.close();
    if (answer !== host) throw config("Confirmation did not match. Nothing was changed.");
  }

  /* ---- cleanup only ---- */
  if (opts.cleanupOnly) {
    const state = readState();
    if (state) {
      if (state.target !== opts.target) throw config(`The recorded run used the ${state.target} target; pass the matching target flags.`);
      if (state.supabaseHost !== host) throw config("The recorded Supabase host does not match this environment; nothing was deleted.");
    }
    if (production) {
      console.log(`Cleanup will delete every load test donor (cpr 9900..., name "Loadtest Donor ...") on ${host}, their photos and the run's rate-limit rows.`);
      await confirmHost("");
    }
    const result = await cleanup({ db, salt, state, target: opts.target });
    for (const n of result.notes) console.log(`Note: ${n}`);
    if (!result.ok) {
      console.log(`FAIL cleanup: ${result.problems.join("; ")}`);
      return 1;
    }
    console.log("PASS cleanup: no load test donors, photos or rate-limit rows remain.");
    return 0;
  }

  if (readState()) {
    throw config("a previous run did not finish; run `pnpm loadtest:cleanup` with the same target flags");
  }

  /* ---- preflight (reads only) ---- */
  const runTag = newRunTag();
  const planned = opts.users + 2;
  const emailBase = opts.emailBase;
  const modes = opts.mode === "both" ? ["slot", "walk-in"] : [opts.mode];
  const runSlot = modes.includes("slot");
  const runWalkIn = modes.includes("walk-in");
  const runRateLimit = !production && !opts.skipRateLimitCheck;
  const slotNeed = planned + (runRateLimit && modes[modes.length - 1] === "slot" ? RATE_LIMIT : 0);

  const existing = await loadMarkerDonors(db, "id");
  if (existing.length) throw config(`${existing.length} load test donors already exist; run \`pnpm loadtest:cleanup\` first.`);
  const event0 = await readEvent(db);

  if (!production && runWalkIn && bahrainClock() >= "23:50") {
    throw config("Local walk-in mode needs a few minutes before midnight in Bahrain; try again after 00:00.");
  }

  /** @param {Awaited<ReturnType<typeof readEvent>>} ev */
  function productionEventProblem(ev) {
    if (!ev.public_registration_open) return "Registration is closed; production runs need it open.";
    if (isWalkInNow(ev)) return "The event is in walk-in mode now; production runs slot mode only.";
    const mins = minutesToWalkIn(ev);
    if (mins !== null && mins < 30) return "The walk-in start time is less than 30 minutes away; the mode would flip during the run.";
    return null;
  }

  let plan0 = null;
  if (runSlot) {
    plan0 = planSlots(await readAvailability(db), slotNeed, opts.reservePlaces);
    if (!plan0) {
      const av = await readAvailability(db);
      const free = av.filter((s) => s.active).reduce((a, s) => a + Math.max(0, s.capacity - s.booked), 0);
      throw config(`Not enough free slot places: ${free} free, ${slotNeed} needed plus ${opts.reservePlaces} to keep free.`);
    }
  }

  if (production) {
    const problem = productionEventProblem(event0);
    if (problem) throw config(problem);
    const envBudget = Number(targetEnv.EMAIL_DAILY_BUDGET);
    const budget = targetEnv.EMAIL_DAILY_BUDGET && Number.isInteger(envBudget) && envBudget >= 0 ? envBudget : GMAIL_DEFAULT_BUDGET;
    if (planned > opts.maxEmails) throw config(`Planned emails (${planned}) exceed --max-emails (${opts.maxEmails}).`);
    const remaining = Number(must(await db.rpc("email_budget_remaining", { p_budget: budget }), "email budget").data);
    if (planned > remaining) throw config(`Planned emails (${planned}) exceed the remaining daily budget (${remaining} of ${budget}).`);
    const lines = [
      "",
      "PRODUCTION LOAD TEST",
      `  Supabase host:       ${host}`,
      `  Test donors:         ${planned} (${opts.users} main, 1 duplicate-CPR winner, 1 replay winner)`,
      "  Slot places held (per slot id, then free room left after):",
      ...[...(plan0?.heldPerSlot ?? new Map())].map(([id, n]) => `    slot ${id}: ${n}`),
      `    free places left after the test: ${plan0?.freeAfter}`,
      `  Emails:              ${planned} real emails; budget remaining ${remaining} of ${budget} before, ${remaining - planned} after`,
      `  Email pattern:       ${emailBase?.split("@")[0]}+lt-${runTag}-<n>@${emailBase?.split("@")[1]}`,
      "  .next will be rebuilt with the production env and discarded afterwards (run `pnpm build` before using `next start` locally again).",
      "  The event row and queue counter are never changed. Test data is removed at the end.",
      "",
    ];
    console.log(lines.join("\n"));
    await confirmHost("");
  }

  /* ---- build and start the server ---- */
  const childEnv = buildChildEnv(process.env, targetEnv, opts.target);
  fs.mkdirSync(LT_DIR, { recursive: true });
  if (production) {
    console.log("Building the app with the production env...");
    // Registered before the build starts, so every way out (success, failure, throw, Ctrl-C) discards it.
    process.on("exit", discardProductionBuild);
    const build = spawnSync(process.execPath, [NEXT_BIN, "build"], { cwd: REPO, env: childEnv, stdio: "inherit" });
    if (build.status !== 0) throw config("next build failed");
    fs.writeFileSync(BUILD_MARK, fs.readFileSync(path.join(REPO, ".next/BUILD_ID"), "utf8").trim());
  } else {
    let buildId;
    try {
      buildId = fs.readFileSync(path.join(REPO, ".next/BUILD_ID"), "utf8").trim();
    } catch {
      throw config("run `pnpm build` first");
    }
    if (fs.existsSync(BUILD_MARK) && fs.readFileSync(BUILD_MARK, "utf8").trim() === buildId) {
      throw config("`.next` was built for production by the load test; run `pnpm build`");
    }
  }

  /** @type {Record<string, any>} */
  const report = { target: opts.target, startedAt: new Date().toISOString(), runTag, options: { ...opts, envFile: undefined, emailBase: emailBase ? emailBase.split("@")[1] : null }, phases: [] };
  /** @type {{ name: string, ok: boolean, reason: string }[]} */
  const checks = [];
  /** @param {string} name @param {boolean} ok @param {string} reason */
  const check = (name, ok, reason) => checks.push({ name, ok, reason });

  /** @type {State|null} */
  let state = null;
  let interrupted = false;
  let exitCode = 0;
  let cleaned = false;

  async function doCleanup() {
    if (cleaned) return null;
    cleaned = true;
    if (!state) return null;
    return cleanup({ db, salt, state, target: opts.target });
  }
  /** @param {NodeJS.Signals} sig */
  const onSignal = async (sig) => {
    if (interrupted) return;
    interrupted = true;
    console.error(`\nReceived ${sig}; cleaning up...`);
    try {
      await stopServer();
      const r = await doCleanup();
      if (r && !r.ok) console.error(`Cleanup left: ${r.problems.join("; ")}`);
    } catch (e) {
      console.error(`Cleanup failed: ${e instanceof Error ? e.message : "unknown"}`);
    }
    process.exit(130);
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  try {
    const base = await startServer(opts, childEnv);

    // Warm-up (not measured). The empty payload fails validation before the rate limit is counted.
    await fetch(`${base}/ar/join`).then((r) => r.arrayBuffer());
    {
      const m = buildMultipart({}, null);
      const warm = await timed(
        `${base}/api/signup`,
        { method: "POST", headers: { "content-type": m.contentType, "content-length": String(m.body.length), "x-real-ip": syntheticIp(runTag, 0xfffff) }, body: m.body },
        opts.timeoutMs,
      );
      if (warm.status !== 400) throw config(`The warm-up request returned ${warm.status}, expected 400.`);
    }

    /* ---- from here on we write ---- */
    state = {
      runTag,
      ipCount: 0,
      target: opts.target,
      supabaseHost: host,
      envFile: production ? opts.envFile : null,
      startedAt: report.startedAt,
      event: production
        ? null
        : {
            event_date: event0.event_date,
            event_start_time: event0.event_start_time,
            public_registration_open: event0.public_registration_open,
            queue_counter: event0.queue_counter,
          },
    };
    writeState(state);

    let donorIndex = 0;
    let ipIndex = 0;
    let imageSeed = 1;
    let reqCounter = 0;
    const nextIp = () => {
      const ip = syntheticIp(runTag, ipIndex++);
      state.ipCount = ipIndex;
      return ip;
    };
    const orphansBefore = await countOrphanFolders(db);
    /** @type {Res[]} */
    const allSignups = [];

    /** @param {Record<string, unknown>} payload @param {string} group @param {string} ip @param {Buffer|null} image */
    const makeReq = (payload, group, ip, image) => {
      const m = buildMultipart(payload, image);
      /** @type {Req} */
      const req = {
        group,
        cpr: /** @type {string} */ (payload.cpr),
        ip,
        submissionId: /** @type {string} */ (payload.submissionId),
        slotId: typeof payload.slotId === "number" ? payload.slotId : null,
        body: m.body,
        contentType: m.contentType,
        hasImage: Boolean(image),
        locale: reqCounter++ % 2 === 0 ? "ar" : "en",
      };
      return req;
    };

    /**
     * @param {string} mode
     * @param {number[]} slots assignments for main, dup winner, replay winner
     */
    function buildPhaseRequests(mode, slots) {
      const walkIn = mode === "walk-in";
      const donorOpts = (/** @type {number} */ slotId) => ({ slotId, walkIn, emailBase, runTag });
      /** @type {Req[]} */
      const reqs = [];
      for (let k = 0; k < opts.users; k++) {
        const idx = donorIndex++;
        reqs.push(makeReq(syntheticDonor(idx, donorOpts(/** @type {number} */ (slots[k]))), "main", nextIp(), syntheticJpeg(opts.imageBytes, imageSeed++)));
      }
      const dupIdx = donorIndex++;
      for (let k = 0; k < opts.dup; k++) {
        reqs.push(makeReq(syntheticDonor(dupIdx, donorOpts(/** @type {number} */ (slots[opts.users]))), "dup", nextIp(), syntheticJpeg(opts.imageBytes, imageSeed++)));
      }
      const replayIdx = donorIndex++;
      const replayPayload = syntheticDonor(replayIdx, donorOpts(/** @type {number} */ (slots[opts.users + 1])));
      const replayReq = makeReq(replayPayload, "replay", nextIp(), syntheticJpeg(opts.imageBytes, imageSeed++));
      for (let k = 0; k < opts.replay; k++) reqs.push({ ...replayReq });
      return reqs;
    }

    /** @param {Req[]} reqs */
    async function stepPages(reqs) {
      return Promise.all(
        reqs.map(async (req) => {
          const r = await timed(`${base}/${req.locale}/join`, { method: "GET" }, opts.timeoutMs);
          return /** @type {Res} */ ({ req, status: r.status, json: null, ms: r.ms, start: r.start, end: r.end, category: classifyResponse({ status: r.status, json: r.status === 200 ? { ok: true } : null, networkError: r.networkError, timedOut: r.timedOut }) });
        }),
      );
    }
    /** @param {Req[]} reqs */
    async function stepSignups(reqs) {
      return Promise.all(
        reqs.map(async (req) => {
          const r = await timed(
            `${base}/api/signup`,
            { method: "POST", headers: { "content-type": req.contentType, "content-length": String(req.body.length), "x-real-ip": req.ip }, body: req.body },
            opts.timeoutMs,
          );
          return /** @type {Res} */ ({ req, status: r.status, json: r.json, ms: r.ms, start: r.start, end: r.end, category: classifyResponse(r) });
        }),
      );
    }
    /** @param {Res[]} signups */
    async function stepCards(signups) {
      const targets = signups.filter((s) => s.category === "ok");
      return Promise.all(
        targets.map(async (s) => {
          if (!s.json?.card) {
            return /** @type {Res} */ ({ req: s.req, status: 0, json: null, ms: 0, start: s.end, end: s.end, category: "unexpected", cardOk: false, cardNote: "no card in the signup response" });
          }
          const r = await timed(
            `${base}/api/card`,
            { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: s.json.card }) },
            opts.timeoutMs,
            true,
          );
          const pdf = r.status === 200 && r.contentType.toLowerCase().includes("application/pdf") && r.magic.startsWith("%PDF");
          const category = pdf ? "ok" : classifyResponse({ status: r.status, json: null, networkError: r.networkError, timedOut: r.timedOut });
          return /** @type {Res} */ ({ req: s.req, status: r.status, json: null, ms: r.ms, start: r.start, end: r.end, category: pdf ? "ok" : category === "ok" ? "unexpected" : category, cardOk: pdf });
        }),
      );
    }

    /** @param {string} step @param {Res[]} results */
    function printStep(step, results) {
      const st = stepStats(results);
      const ok = st.categories.ok ?? 0;
      console.log(
        `  ${pad(step, 8)} n=${pad(results.length, 4)} ok=${pad(ok, 4)} p50=${pad(ms(st.all.p50), 6)} p95=${pad(ms(st.all.p95), 6)} p99=${pad(ms(st.all.p99), 6)} max=${pad(ms(st.all.max), 6)} ok/s=${st.throughput === null ? "-" : st.throughput.toFixed(1)}`,
      );
      return st;
    }

    /** @param {Record<string, number>} categories @param {string} where */
    function printCategories(categories, where) {
      const expected = (/** @type {string} */ c) =>
        (where === "rl" && c === "rate_limited") || (where === "dup" && c === "duplicate_cpr") ? " (expected)" : "";
      const parts = Object.entries(categories).map(([c, n]) => `${c}=${n}${expected(c)}`);
      console.log(`           categories: ${parts.join(", ")}`);
    }

    /** Shared photo check. @param {{ id: string }[]} entries */
    async function checkPhotos(/** @type {string} */ name, entries) {
      const bad = [];
      await pool(entries, 10, async ({ id }) => {
        const files = await listFolder(db, id);
        const f = files[0];
        const size = f?.metadata?.size;
        if (files.length !== 1 || f?.name !== "cpr.jpg" || size !== opts.imageBytes) bad.push(id);
      });
      check(name, bad.length === 0, bad.length ? `image_not_attached for ${bad.length} of ${entries.length} donors (${bad.slice(0, 5).join(", ")})` : `${entries.length} donors have exactly one cpr.jpg of ${opts.imageBytes} bytes`);
    }

    /** Runs one phase (A slot or B walk-in). @param {"slot"|"walk-in"} mode */
    async function runMainPhase(mode) {
      const walkIn = mode === "walk-in";
      const label = walkIn ? "B (walk-in)" : "A (slot)";
      console.log(`\nPhase ${label}`);

      /** @type {number[]} */
      let slots = [];
      let rlSlots = [];
      if (!walkIn) {
        const need = planned + (runRateLimit && modes[modes.length - 1] === "slot" ? RATE_LIMIT : 0);
        const plan = planSlots(await readAvailability(db), need, opts.reservePlaces);
        if (!plan) throw config("Not enough free slot places for this phase.");
        slots = plan.assignments.slice(0, planned);
        rlSlots = plan.assignments.slice(planned);
      }

      if (!production) {
        const patch = walkIn
          ? { event_date: bahrainDate(), event_start_time: "00:00", public_registration_open: true }
          : { event_date: addDays(bahrainDate(), 7), public_registration_open: true };
        must(await db.from("event").update(patch).eq("id", true), "set event");
        const back = await readEvent(db);
        if (isWalkInNow(back) !== walkIn) throw config("The event row did not switch to the intended mode.");
      }

      const reqs = buildPhaseRequests(mode, walkIn ? [] : slots);
      const phase = { name: label, mode, steps: /** @type {Record<string, any>} */ ({}) };
      report.phases.push(phase);

      const pages = await stepPages(reqs);
      phase.steps.pages = printStep("pages", pages);

      let counterBefore = 0;
      let queueStart = 1;
      if (production) {
        const ev = await readEvent(db);
        const problem = productionEventProblem(ev);
        if (problem) throw config(`Aborting: ${problem}`);
      }
      if (walkIn) {
        const ev = await readEvent(db);
        counterBefore = ev.queue_counter;
        queueStart = ev.queue_start;
      }
      state.ipCount = ipIndex;
      writeState(state);

      const signups = await stepSignups(reqs);
      allSignups.push(...signups);
      phase.steps.signup = printStep("signup", signups);
      printCategories(phase.steps.signup.categories, "main");
      for (const g of ["main", "dup", "replay"]) {
        const groupResults = signups.filter((s) => s.req.group === g);
        const st = stepStats(groupResults);
        phase.steps[`signup_${g}`] = st;
        console.log(`           ${pad(g, 7)} ${Object.entries(st.categories).map(([c, n]) => `${c}=${n}${g === "dup" && c === "duplicate_cpr" ? " (expected)" : ""}`).join(", ")}`);
      }
      const counterAfter = walkIn ? (await readEvent(db)).queue_counter : 0;

      /** @type {Res[]} */
      let cards = [];
      if (!opts.noCard) {
        cards = await stepCards(signups);
        phase.steps.card = printStep("card", cards);
        printCategories(phase.steps.card.categories, "card");
      }

      // ---- checks ----
      const rows = await loadMarkerDonors(db, "id, cpr, slot_id, source, status, queue_number, cpr_image_path, email, email_sent, email_last_error");
      /** @type {Map<string, any[]>} */
      const byCpr = new Map();
      for (const r of rows) byCpr.set(r.cpr, [...(byCpr.get(r.cpr) ?? []), r]);
      const rowFor = (/** @type {string} */ cpr) => (byCpr.get(cpr) ?? [])[0];

      const main = signups.filter((s) => s.req.group === "main");
      const dup = signups.filter((s) => s.req.group === "dup");
      const replay = signups.filter((s) => s.req.group === "replay");

      // 1. Main, under load.
      {
        const problems = [];
        const notOk = main.filter((s) => s.category !== "ok");
        if (notOk.length) problems.push(`${notOk.length} main signups not ok (${JSON.stringify(countBy(notOk.map((s) => s.category)))})`);
        const rl = signups.filter((s) => s.category === "rate_limited").length;
        if (rl) problems.push(`rate_limited x${rl}: ${CATEGORY_HINTS.rate_limited}`);
        const p95 = phase.steps.signup.all.p95;
        const max = phase.steps.signup.all.max;
        if (p95 !== null && p95 > opts.p95BudgetMs) problems.push(`signup p95 ${ms(p95)} ms is over the ${opts.p95BudgetMs} ms budget`);
        if (max !== null && max >= LATENCY_HARD_LIMIT_MS) problems.push(`slowest signup ${ms(max)} ms is at or over ${LATENCY_HARD_LIMIT_MS} ms`);
        const turnstile = signups.filter((s) => s.category === "turnstile").length;
        if (turnstile) problems.push(`turnstile x${turnstile}: ${CATEGORY_HINTS.turnstile}`);
        let wrongRow = 0;
        for (const s of main) {
          const found = byCpr.get(s.req.cpr) ?? [];
          const row = found[0];
          if (found.length !== 1 || !row) wrongRow++;
          else if (!walkIn && row.slot_id !== s.req.slotId) wrongRow++;
          else if (s.json?.card && String(s.json.card).split(".")[0] !== row.id) wrongRow++;
        }
        if (wrongRow) problems.push(`${wrongRow} main donors do not have exactly one matching row`);
        if (!opts.noCard) {
          const mainCards = cards.filter((c) => c.req.group === "main");
          const badCards = mainCards.filter((c) => !c.cardOk).length + main.filter((s) => s.category === "ok" && !s.json?.card).length;
          if (badCards) problems.push(`${badCards} card downloads failed`);
        }
        check(`${label}: main under load`, problems.length === 0, problems.join("; ") || `${main.length} signups ok, p95 ${ms(p95)} ms, max ${ms(max)} ms`);
      }

      // 2. Photos (main plus the dup and replay winners).
      {
        const winners = [...main, ...dup.filter((s) => s.category === "ok"), ...replay.slice(0, 1).filter((s) => s.category === "ok")];
        const entries = winners.map((s) => rowFor(s.req.cpr)).filter(Boolean);
        const missingPath = entries.filter((r) => r.cpr_image_path !== `${r.id}/cpr.jpg`).length;
        await checkPhotos(`${label}: photos`, entries);
        if (missingPath) check(`${label}: photo paths`, false, `${missingPath} donors have a wrong cpr_image_path (image_not_attached)`);
      }

      // 3. Duplicate CPR.
      {
        const okCount = dup.filter((s) => s.category === "ok").length;
        const losers = dup.filter((s) => s.category !== "ok");
        const badLosers = losers.filter((s) => s.category !== "duplicate_cpr").length;
        const dupRows = byCpr.get(dup[0]?.req.cpr ?? "") ?? [];
        const files = dupRows[0] ? (await listFolder(db, dupRows[0].id)).length : -1;
        const problems = [];
        if (okCount !== 1) problems.push(`${okCount} ok (expected exactly 1)`);
        if (badLosers) problems.push(`${badLosers} losers were not duplicate_cpr`);
        if (dupRows.length !== 1) problems.push(`${dupRows.length} rows (expected 1)`);
        if (files !== 1) problems.push(`${files} objects (expected 1)`);
        check(`${label}: duplicate CPR`, problems.length === 0, problems.join("; ") || `1 winner, ${losers.length} duplicate_cpr, 1 row, 1 object`);
      }

      // 4. Replay.
      {
        const problems = [];
        const notOk = replay.filter((s) => s.category !== "ok").length;
        if (notOk) problems.push(`${notOk} replays not ok`);
        const refs = new Set(replay.map((s) => s.json?.ref));
        if (refs.size !== 1) problems.push(`${refs.size} different refs`);
        if (walkIn && new Set(replay.map((s) => s.json?.queueNumber)).size !== 1) problems.push("different queue numbers");
        const repRows = byCpr.get(replay[0]?.req.cpr ?? "") ?? [];
        if (repRows.length !== 1) problems.push(`${repRows.length} rows (expected 1)`);
        const files = repRows[0] ? (await listFolder(db, repRows[0].id)).length : -1;
        if (files !== 1) problems.push(`${files} objects (expected 1)`);
        check(`${label}: replay`, problems.length === 0, problems.join("; ") || `${replay.length} replays, one ref, 1 row, 1 object`);
      }

      // 5. Walk-in queue.
      if (walkIn) {
        const phaseRows = [...new Set(signups.map((s) => s.req.cpr))].map(rowFor).filter(Boolean);
        const q = checkQueue({ numbers: phaseRows.map((r) => r.queue_number), counterBefore, queueStart, counterAfter });
        const problems = [];
        if (!q.ok) problems.push(`queue numbers wrong (expected ${q.expectedStart}..${q.expectedEnd}, duplicates ${q.duplicates.length}, missing ${q.missing.length}, extra ${q.extra.length}, counter after ${counterAfter})`);
        const mismatched = signups.filter((s) => s.category === "ok" && s.json?.queueNumber !== rowFor(s.req.cpr)?.queue_number).length;
        if (mismatched) problems.push(`${mismatched} responses disagree with the stored queue number`);
        const badRows = phaseRows.filter((r) => r.status !== "waiting" || r.slot_id !== null).length;
        if (badRows) problems.push(`${badRows} rows are not waiting with a null slot`);
        check(`${label}: walk-in queue`, problems.length === 0, problems.join("; ") || `numbers ${q.expectedStart}..${q.expectedEnd} contiguous`);
      }

      // Rate limit phase (last mode used).
      if (runRateLimit && mode === modes[modes.length - 1]) {
        console.log("\nPhase C (rate limit, one IP)");
        const ip = nextIp();
        const rlReqs = [];
        for (let k = 0; k < opts.rateLimitRequests; k++) {
          const idx = donorIndex++;
          const slotId = walkIn ? 0 : /** @type {number} */ (rlSlots[k % Math.max(1, rlSlots.length)]);
          rlReqs.push(makeReq(syntheticDonor(idx, { slotId, walkIn, emailBase, runTag }), "rl", ip, syntheticJpeg(opts.imageBytes, imageSeed++)));
        }
        state.ipCount = ipIndex;
        writeState(state);
        const rl = await stepSignups(rlReqs);
        const cphase = { name: "C (rate limit)", mode, steps: { signup: printStep("signup", rl) } };
        report.phases.push(cphase);
        printCategories(cphase.steps.signup.categories, "rl");
        const okN = rl.filter((s) => s.category === "ok").length;
        const limited = rl.filter((s) => s.category === "rate_limited").length;
        check("C: rate limit", okN === RATE_LIMIT && limited === rl.length - RATE_LIMIT, `${okN} ok and ${limited} rate_limited of ${rl.length} (expected ${RATE_LIMIT} ok)`);
      }
    }

    if (runSlot) await runMainPhase("slot");
    if (runWalkIn) await runMainPhase("walk-in");

    // 7. Orphaned objects, and run donors without a photo path.
    {
      const after = await countOrphanFolders(db);
      const rows = await loadMarkerDonors(db, "id, cpr_image_path");
      const noPath = rows.filter((r) => !r.cpr_image_path);
      const withObjects = (await pool(noPath, 10, async (r) => (await listFolder(db, r.id)).length)).filter((n) => n > 0).length;
      check(
        "No orphaned photos",
        after.orphans <= orphansBefore.orphans && withObjects === 0,
        `orphan folders ${orphansBefore.orphans} before, ${after.orphans} after; ${withObjects} donors without a path have objects`,
      );
    }

    // 8. Email (production only).
    if (production) {
      // The emails go out in after(), so wait (bounded) until each is sent or has failed.
      const waitStart = Date.now();
      let rows = await loadMarkerDonors(db, "id, email, email_sent, email_last_error");
      while (pendingEmailCount(rows) > 0 && Date.now() - waitStart < EMAIL_SETTLE_MS) {
        console.log(`Waiting for ${pendingEmailCount(rows)} of ${rows.length} emails...`);
        await sleep(EMAIL_POLL_MS);
        rows = await loadMarkerDonors(db, "id, email, email_sent, email_last_error");
      }
      report.emailWaitMs = Date.now() - waitStart;
      const outcomes = rows.map((r) => emailOutcome(r));
      const counts = countBy(outcomes);
      report.emailOutcomes = counts;
      const mainEmailStatus = allSignups.filter((s) => s.req.group === "main").map((s) => String(s.json?.emailStatus ?? s.category));
      report.emailStatusResponses = countBy(allSignups.map((s) => String(s.json?.emailStatus ?? s.category)));
      console.log(`Email status in responses: ${JSON.stringify(report.emailStatusResponses)}`);
      console.log(`\nEmail outcomes (donor rows): ${JSON.stringify(counts)}`);
      const problems = [];
      if (counts.failed) problems.push(`${counts.failed} failed: Gmail refused or timed out. Each signup opens its own SMTP connection; Gmail limits simultaneous connections per account. Check server.log for the smtp error code.`);
      let inFlight = 0;
      if (counts.queued) {
        for (const part of chunks(rows.map((r) => r.id), 100)) {
          const claimed = must(await db.from("email_sends").select("donor_id").eq("status", "claimed").in("donor_id", part), "email_sends claimed").data ?? [];
          inFlight += claimed.length;
        }
        problems.push(`${counts.queued} not sent within 90 s (still sending, or the email budget is used up; check email_budget_remaining and server.log)${inFlight > 0 ? `; ${inFlight} still in flight` : ""}`);
      }
      if (outcomes.some((o) => o !== "sent") && !counts.failed && !counts.queued) problems.push("some donors have no email outcome of sent");
      if (mainEmailStatus.some((v) => v !== "sending")) problems.push("some main responses did not say emailStatus sending");
      if (rows.length !== planned) problems.push(`${rows.length} donor rows (expected ${planned})`);
      const sends = [];
      for (const part of chunks(rows.map((r) => r.id), 100)) {
        sends.push(...(must(await db.from("email_sends").select("donor_id, status").in("donor_id", part), "email_sends").data ?? []));
      }
      const per = countBy(sends.map((s) => s.donor_id));
      const badSends = rows.filter((r) => per[r.id] !== 1).length + sends.filter((s) => s.status !== "sent").length;
      if (badSends) problems.push(`${badSends} donors do not have exactly one email_sends row with status sent`);
      check("Email", problems.length === 0, problems.join("; ") || `${rows.length} donors, one sent email each`);
    }
  } catch (e) {
    if (e instanceof ExitError) {
      console.error(e.message);
      exitCode = e.code;
    } else {
      console.error(`Run failed: ${e instanceof Error ? e.message : "unknown"}`);
      checks.push({ name: "Run completed", ok: false, reason: e instanceof Error ? e.message : "unknown" });
    }
  } finally {
    await stopServer();
    let cleanupResult = null;
    if (!opts.keep) {
      try {
        cleanupResult = await doCleanup();
      } catch (e) {
        checks.push({ name: "Cleanup", ok: false, reason: e instanceof Error ? e.message : "unknown" });
      }
    }
    if (cleanupResult) {
      for (const n of cleanupResult.notes) console.log(`Note: ${n}`);
      checks.push({ name: "Cleanup", ok: cleanupResult.ok, reason: cleanupResult.ok ? "no test donors, photos or rate-limit rows remain" : cleanupResult.problems.join("; ") });
    }
    if (production) console.log("The production build was discarded; run `pnpm build` before using `next start` locally again.");
  }

  process.off("SIGINT", onSignal);
  process.off("SIGTERM", onSignal);

  console.log("\nChecks");
  for (const c of checks) console.log(`  ${c.ok ? "PASS" : "FAIL"}  ${c.name}: ${c.reason}`);
  const result = verdict(checks);
  report.checks = checks;
  report.verdict = result;
  report.finishedAt = new Date().toISOString();
  fs.mkdirSync(LT_DIR, { recursive: true });
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));

  if (exitCode === 2) return 2;
  console.log(`\nRESULT: ${result} [${opts.target}]: ${opts.users} concurrent signups with ${opts.imageBytes}-byte photos`);
  return result === "PASS" && checks.length > 0 ? 0 : 1;
}

try {
  process.exitCode = await main();
} catch (e) {
  if (e instanceof ExitError) {
    console.error(e.message);
    process.exitCode = e.code;
  } else {
    console.error(`Unexpected error: ${e instanceof Error ? e.message : "unknown"}`);
    process.exitCode = 1;
  }
}
