import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({ claims: null as unknown, throwOnClaims: false }));
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: {
      getClaims: async () => {
        if (h.throwOnClaims) throw new Error("network down");
        return { data: h.claims ? { claims: h.claims } : null, error: null };
      },
    },
  }),
}));

import { config, proxy } from "@/proxy";

const req = (path: string) => new NextRequest(`http://localhost:3000${path}`);
const env = { ...process.env };

beforeEach(() => {
  h.claims = null;
  h.throwOnClaims = false;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
});
afterEach(() => {
  process.env = { ...env };
});

describe("proxy.ts", () => {
  it("matches only /admin paths", () => {
    expect(config.matcher).toEqual(["/admin/:path*"]);
  });
  it("redirects a signed-out visitor from /admin and sub-pages to /admin/login", async () => {
    for (const p of ["/admin", "/admin/donors/new", "/admin/export", "/admin/donors/abc?x=1"]) {
      const res = await proxy(req(p));
      expect(res.status).toBe(307);
      const loc = new URL(res.headers.get("location")!);
      expect(loc.pathname).toBe("/admin/login");
      expect(loc.search).toBe("");
    }
  });
  it("lets the login page through when signed out (no redirect loop)", async () => {
    const res = await proxy(req("/admin/login"));
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });
  it("lets a signed-in user through", async () => {
    h.claims = { sub: "u1" };
    const res = await proxy(req("/admin"));
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });
  it("treats a getClaims failure as signed out", async () => {
    h.throwOnClaims = true;
    expect((await proxy(req("/admin"))).status).toBe(307);
  });
  it("redirects when Supabase env is missing (fails closed)", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    expect((await proxy(req("/admin"))).status).toBe(307);
  });
});
