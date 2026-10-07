import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

/* Every case must exit 2 before any network call. None passes --yes. */

const run = (args: string[], env: Record<string, string> = {}) =>
  spawnSync(process.execPath, ["scripts/loadtest/run.mjs", ...args], {
    env: { PATH: process.env.PATH ?? "", ...env } as unknown as NodeJS.ProcessEnv,
    encoding: "utf8",
    timeout: 20_000,
  });

const created: string[] = [];
afterEach(() => {
  for (const f of created.splice(0)) fs.rmSync(f, { force: true });
});

const baseVars = (url: string, extra = "") =>
  [
    `NEXT_PUBLIC_SUPABASE_URL=${url}`,
    "NEXT_PUBLIC_SUPABASE_ANON_KEY=dummy-anon",
    "SUPABASE_SERVICE_ROLE_KEY=dummy-service",
    "RATE_LIMIT_SALT=dummy-salt",
    "CRON_SECRET=dummy-cron",
    extra,
  ].join("\n");

const envFileInRepo = (contents: string) => {
  const name = `.env.loadtest-test-${randomBytes(6).toString("hex")}`;
  fs.writeFileSync(name, contents);
  created.push(name);
  return name;
};

const prod = (file: string) => ["--target", "production", "--env-file", file, "--email-base", "owner@example.com"];

describe("scripts/loadtest/run.mjs guards", () => {
  it("the local target refuses a non-local Supabase URL", () => {
    const r = run([], { NEXT_PUBLIC_SUPABASE_URL: "https://example.invalid" });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("Refusing to run");
  });
  it("refuses when the URL is missing", () => {
    expect(run([]).status).toBe(2);
  });
  it("exits 2 for an unknown flag", () => {
    const r = run(["--nope"], { NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321" });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("Unknown option");
  });
  it("production without --env-file exits 2", () => {
    const r = run(["--target", "production", "--email-base", "owner@example.com"]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("--env-file");
  });
  it("production with an env file outside the repository exits 2", () => {
    const file = path.join(os.tmpdir(), `loadtest-guard-${randomBytes(6).toString("hex")}.env`);
    fs.writeFileSync(file, baseVars("https://example.invalid"));
    created.push(file);
    const r = run(prod(file));
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("git-ignored file inside the repository");
  });
  it("production with a local Supabase URL tells the user to use the local target", () => {
    const r = run(prod(envFileInRepo(baseVars("http://127.0.0.1:54321"))));
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("use the local target");
  });
  it("production without Gmail values exits 2", () => {
    const r = run(prod(envFileInRepo(baseVars("https://example.invalid"))));
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("Gmail config");
  });
  it("production with missing required variables names them, not their values", () => {
    const r = run(prod(envFileInRepo("NEXT_PUBLIC_SUPABASE_URL=https://example.invalid\n")));
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(r.stderr).not.toContain("example.invalid");
  });
  it("production without --email-base exits 2", () => {
    const r = run(["--target", "production", "--env-file", envFileInRepo(baseVars("https://example.invalid"))]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("--email-base");
  });
  it("production with --mode both or --keep exits 2", () => {
    const f = envFileInRepo(baseVars("https://example.invalid"));
    for (const extra of [["--mode", "both"], ["--mode", "walk-in"], ["--keep"]]) {
      const r = run([...prod(f), ...extra]);
      expect(r.status).toBe(2);
    }
  });
  it("production with a plus in the email base exits 2", () => {
    const f = envFileInRepo(baseVars("https://example.invalid"));
    const r = run(["--target", "production", "--env-file", f, "--email-base", "owner+x@example.com"]);
    expect(r.status).toBe(2);
  });
  it("local with --env-file or --email-base exits 2", () => {
    const env = { NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321" };
    expect(run(["--env-file", ".env.local"], env).status).toBe(2);
    expect(run(["--email-base", "owner@example.com"], env).status).toBe(2);
  });
  it("cleanup-only against production without an env file exits 2", () => {
    expect(run(["--cleanup-only", "--target", "production"]).status).toBe(2);
  });
  it("production cleanup-only with a local URL exits 2 before any delete", () => {
    const r = run(["--cleanup-only", ...prod(envFileInRepo(baseVars("http://127.0.0.1:54321")))]);
    expect(r.status).toBe(2);
  });
});

describe("cleanup safety (source)", () => {
  const src = fs.readFileSync("scripts/loadtest/run.mjs", "utf8");
  it("deletes donors only with both marker filters and never touches email_sends", () => {
    expect(src).toMatch(/from\("donors"\)\.delete\(\)\.in\("id", batch\)\.like\("cpr", MARKER_CPR\)\.like\("full_name", MARKER_NAME\)/);
    expect(src).not.toMatch(/from\("email_sends"\)\.delete/);
    expect(src).not.toContain("--target production --yes");
  });
  it("discards the production build on exit, registered before the build starts", () => {
    const hook = src.indexOf('process.on("exit", discardProductionBuild)');
    const build = src.indexOf('[NEXT_BIN, "build"]');
    expect(hook).toBeGreaterThan(-1);
    expect(build).toBeGreaterThan(hook);
    expect(src).toMatch(/function discardProductionBuild\(\) \{\n  for \(const p of \[path\.join\(REPO, "\.next\/BUILD_ID"\), BUILD_MARK\]\)/);
  });
});
