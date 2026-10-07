import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  rpc: vi.fn(),
  signIn: vi.fn(),
  hdrs: new Headers({ "x-real-ip": "203.0.113.9" }),
  peekAllowed: true,
}));

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => h.hdrs }));
vi.mock("@/lib/auth", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/email/dispatch", () => ({ sendDonorEmail: vi.fn() }));
vi.mock("@/lib/env", () => ({ serverEnv: () => ({ RATE_LIMIT_SALT: "test-salt-test-salt" }) }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => ({ rpc: h.rpc }) }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ auth: { signInWithPassword: h.signIn } }),
}));

import { signIn } from "@/app/admin/actions";

const fd = () => {
  const f = new FormData();
  f.set("email", "admin@example.org");
  f.set("password", "correct horse battery");
  return f;
};

beforeEach(() => {
  vi.clearAllMocks();
  h.peekAllowed = true;
  h.hdrs = new Headers({ "x-real-ip": "203.0.113.9" });
  h.rpc.mockImplementation(async (name: string) => ({ data: name === "rate_limit_peek" ? h.peekAllowed : true, error: null }));
});

describe("signIn rate limit", () => {
  it("counts a failed attempt under a hashed key, never the raw IP", async () => {
    h.signIn.mockResolvedValue({ error: { message: "bad" } });
    expect(await signIn({ ok: false }, fd())).toEqual({ ok: false, error: "Invalid email or password" });
    const hit = h.rpc.mock.calls.find((c) => c[0] === "rate_limit_hit");
    expect(hit?.[1]).toMatchObject({ p_limit: 10, p_window_seconds: 900 });
    expect(hit?.[1].p_key).toMatch(/^login:[0-9a-f]{64}$/);
    expect(JSON.stringify(h.rpc.mock.calls)).not.toContain("203.0.113.9");
  });
  it("does not count a successful sign-in", async () => {
    h.signIn.mockResolvedValue({ error: null });
    await expect(signIn({ ok: false }, fd())).rejects.toThrow("NEXT_REDIRECT:/admin");
    expect(h.rpc.mock.calls.some((c) => c[0] === "rate_limit_hit")).toBe(false);
  });
  it("blocks over the limit with the same generic error and never calls Supabase Auth", async () => {
    h.peekAllowed = false;
    expect(await signIn({ ok: false }, fd())).toEqual({ ok: false, error: "Invalid email or password" });
    expect(h.signIn).not.toHaveBeenCalled();
    expect(h.rpc.mock.calls.some((c) => c[0] === "rate_limit_hit")).toBe(false);
  });
  it("fails open when the limiter errors", async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: "down" } });
    h.signIn.mockResolvedValue({ error: null });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(signIn({ ok: false }, fd())).rejects.toThrow("NEXT_REDIRECT:/admin");
    spy.mockRestore();
  });
  it("skips the limiter when there is no client IP", async () => {
    h.hdrs = new Headers();
    h.signIn.mockResolvedValue({ error: { message: "bad" } });
    await signIn({ ok: false }, fd());
    expect(h.rpc).not.toHaveBeenCalled();
  });
});
