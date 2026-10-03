import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const run = (env: Record<string, string>, args: string[] = ["a@example.org", "a-long-password-1"]) =>
  spawnSync(process.execPath, ["scripts/create-local-admin.mjs", ...args], {
    env: { PATH: process.env.PATH ?? "", ...env } as unknown as NodeJS.ProcessEnv,
    encoding: "utf8",
    timeout: 20_000,
  });

describe("scripts/create-local-admin.mjs", () => {
  it.each([
    "https://abcdefgh.supabase.co",
    "https://localhost.evil.example",
    "http://127.0.0.1.evil.example",
    "http://example.com:54321",
    "",
    "not a url",
  ])("refuses to run against %j and never contacts anything", (url) => {
    const r = run({ NEXT_PUBLIC_SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: "k" });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("Refusing to run");
  });
  it("on localhost it gets past the guard and asks for the missing arguments", () => {
    const r = run({ NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321", SUPABASE_SERVICE_ROLE_KEY: "k" }, []);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("Usage");
    expect(r.stderr).not.toContain("Refusing");
  });
  it("rejects a short password before any network call", () => {
    const r = run({ NEXT_PUBLIC_SUPABASE_URL: "http://localhost:54321", SUPABASE_SERVICE_ROLE_KEY: "k" }, ["a@example.org", "short"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("12 characters");
  });
});
