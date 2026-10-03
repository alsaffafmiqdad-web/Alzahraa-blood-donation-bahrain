import { beforeEach, describe, expect, it, vi } from "vitest";

/** Every admin page must call requireAdmin() before it reads any data. Real requireAdmin, fake client. */
class RedirectError extends Error {
  constructor(public to: string) {
    super(`NEXT_REDIRECT:${to}`);
  }
}
const h = vi.hoisted(() => ({ user: null as null | { id: string }, adminRow: null as null | { display_name: string }, reads: [] as string[] }));

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new RedirectError(to);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: h.user }, error: null }), signOut: async () => {} },
    from: (t: string) => {
      const c: Record<string, unknown> = {};
      for (const op of ["select", "eq", "order", "limit", "in"]) c[op] = () => c;
      c.maybeSingle = async () => ({ data: t === "admins" ? h.adminRow : null, error: null });
      c.single = async () => ({ data: null, error: null });
      c.then = (r: (v: unknown) => unknown) => {
        if (t !== "admins") h.reads.push(t);
        return r({ data: [], error: null });
      };
      return c;
    },
    rpc: async () => ({ data: null, error: null }),
  }),
}));
vi.mock("@/lib/db/public", () => ({ getEvent: vi.fn(), getSlotAvailability: vi.fn() }));

const ID = "11111111-2222-4333-8444-555555555555";
const pages: [string, () => Promise<{ default: (p: never) => Promise<unknown> }>, unknown][] = [
  ["/admin", () => import("@/app/admin/page"), { searchParams: Promise.resolve({}) }],
  ["/admin/account", () => import("@/app/admin/account/page"), {}],
  ["/admin/donors/new", () => import("@/app/admin/donors/new/page"), {}],
  ["/admin/donors/[id]", () => import("@/app/admin/donors/[id]/page"), { params: Promise.resolve({ id: ID }), searchParams: Promise.resolve({}) }],
  ["/admin/donors/[id]/edit", () => import("@/app/admin/donors/[id]/edit/page"), { params: Promise.resolve({ id: ID }) }],
  ["/admin/donors/[id]/print", () => import("@/app/admin/donors/[id]/print/page"), { params: Promise.resolve({ id: ID }) }],
  ["/admin/print", () => import("@/app/admin/print/page"), { searchParams: Promise.resolve({}) }],
  ["/admin/slots", () => import("@/app/admin/slots/page"), {}],
  ["/admin/event", () => import("@/app/admin/event/page"), {}],
];

beforeEach(() => {
  h.user = null;
  h.adminRow = null;
  h.reads.length = 0;
});

describe.each(pages)("%s", (_path, load, props) => {
  it("redirects an unauthenticated visitor before reading data", async () => {
    const mod = await load();
    await expect(mod.default(props as never)).rejects.toMatchObject({ to: "/admin/login" });
    expect(h.reads).toEqual([]);
  });
  it("redirects a signed-in non-admin before reading data", async () => {
    h.user = { id: "stranger" };
    const mod = await load();
    await expect(mod.default(props as never)).rejects.toMatchObject({ to: "/admin/login?error=not_admin" });
    expect(h.reads).toEqual([]);
  });
});
