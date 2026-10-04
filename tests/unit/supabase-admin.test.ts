import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetEnvCache } from "@/lib/env";
import { createSupabaseAdminClient, fetchWithDeadline } from "@/lib/supabase/admin";

const envBackup = { ...process.env };

beforeEach(() => {
  Object.assign(process.env, {
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
    SUPABASE_SERVICE_ROLE_KEY: "svc",
    TURNSTILE_SECRET_KEY: "tsecret",
    RATE_LIMIT_SALT: "salt",
    CRON_SECRET: "c",
    RESEND_API_KEY: "re_dummy",
  });
  resetEnvCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  for (const k of Object.keys(process.env)) if (!(k in envBackup)) delete process.env[k];
  Object.assign(process.env, envBackup);
  resetEnvCache();
});

const makeHang = () =>
  vi.fn(
    (_u: unknown, init?: RequestInit) =>
      new Promise<Response>((_, reject) => {
        const s = init?.signal;
        if (s?.aborted) return reject(s.reason);
        s?.addEventListener("abort", () => reject(s.reason), { once: true });
      }),
  );

describe("fetchWithDeadline", () => {
  it("aborts at the deadline with a TimeoutError", async () => {
    vi.stubGlobal("fetch", makeHang());
    await expect(fetchWithDeadline(AbortSignal.timeout(30))("http://x/a")).rejects.toMatchObject({
      name: "TimeoutError",
    });
  });

  it("still honours the caller's own signal", async () => {
    vi.stubGlobal("fetch", makeHang());
    const ctrl = new AbortController();
    const p = fetchWithDeadline(AbortSignal.timeout(60_000))("http://x/a", { signal: ctrl.signal });
    ctrl.abort();
    await expect(p).rejects.toMatchObject({ name: "AbortError" });
  });

  it("passes url and init through, using the deadline signal itself when the caller gave none", async () => {
    const stub = vi.fn(async () => new Response("ok"));
    vi.stubGlobal("fetch", stub);
    const deadline = AbortSignal.timeout(60_000);
    await fetchWithDeadline(deadline)("http://x/a", { method: "POST", headers: { a: "b" } });
    const [url, init] = stub.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://x/a");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ a: "b" });
    expect(init.signal).toBe(deadline);
  });
});

describe("createSupabaseAdminClient", () => {
  it("applies the deadline to storage calls", async () => {
    const hang = makeHang();
    vi.stubGlobal("fetch", hang);
    const res = await createSupabaseAdminClient({ deadlineMs: 30 })
      .storage.from("cpr-images")
      .upload("a/cpr.jpg", new Uint8Array([1]))
      .catch((e: unknown) => ({ error: e }));
    expect(res.error).toBeTruthy();
    const [url, init] = hang.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(url)).toContain("/storage/v1/object/cpr-images/a/cpr.jpg");
    expect(init.signal?.aborted).toBe(true);
  });

  it("does not wrap fetch when no deadline is given", async () => {
    const stub = vi.fn(async () => new Response("[]", { headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", stub);
    await createSupabaseAdminClient().from("donors").select("id");
    const init = (stub.mock.calls[0] as unknown as [unknown, RequestInit?])[1];
    expect(init?.signal).toBeUndefined();
  });
});
