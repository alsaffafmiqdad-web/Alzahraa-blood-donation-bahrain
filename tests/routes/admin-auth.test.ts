import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Every admin Server Action and the CSV route must refuse unauthenticated and non-admin callers
 * on their own (not relying on proxy.ts). Uses the REAL requireAdmin() with a fake Supabase client.
 */
class RedirectError extends Error {
  constructor(public to: string) {
    super(`NEXT_REDIRECT:${to}`);
  }
}

const h = vi.hoisted(() => ({
  user: null as null | { id: string },
  adminRow: null as null | { display_name: string },
  calls: [] as string[],
  sendDonorEmail: vi.fn(),
  createAdmin: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new RedirectError(to);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/db/status-labels", () => ({ getStatusLabels: async () => ({}) }));
vi.mock("@/lib/db/admins", () => ({ createAdmin: h.createAdmin }));
vi.mock("@/lib/email/dispatch", () => ({ sendDonorEmail: h.sendDonorEmail }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => {
    const q = (table: string) => {
      const c: Record<string, unknown> = {};
      const rec = (op: string) => () => {
        h.calls.push(`${table}.${op}`);
        return c;
      };
      for (const op of ["select", "insert", "update", "delete", "eq", "not", "lt", "order", "limit", "range"]) c[op] = rec(op);
      c.maybeSingle = async () => ({ data: table === "admins" ? h.adminRow : null, error: null });
      c.single = async () => ({ data: null, error: null });
      c.then = (res: (v: unknown) => unknown) => res({ data: [], error: null, count: 0 });
      return c;
    };
    return {
      auth: {
        getUser: async () => ({ data: { user: h.user }, error: null }),
        signOut: async () => {
          h.calls.push("auth.signOut");
        },
        updateUser: async () => {
          h.calls.push("auth.updateUser");
          return { error: null };
        },
        signInWithPassword: async () => ({ error: null }),
      },
      rpc: async (name: string) => {
        h.calls.push(`rpc.${name}`);
        return { data: null, error: null };
      },
      from: (t: string) => q(t),
    };
  },
}));

import * as actions from "@/app/admin/actions";
import { GET as exportCsv } from "@/app/admin/export/route";

const ID = "11111111-2222-4333-8444-555555555555";
const fd = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};
const prev = { ok: false } as never;

const guarded: Record<string, () => Promise<unknown>> = {
  addDonor: () =>
    actions.addDonor(prev, fd({ mode: "walk_in", fullName: "Ali", cpr: "990101123", consent: "on", bloodType: "unknown" })),
  editDonor: () => actions.editDonor(prev, fd({ id: ID, fullName: "Ali", cpr: "990101123", bloodType: "unknown" })),
  searchDonors: () => actions.searchDonors(fd({ q: "990101123" })),
  checkInDonor: () => actions.checkInDonor(ID),
  setDonorStatus: () => actions.setDonorStatus({ donorId: ID, status: "donated" }),
  verifyDonor: () => actions.verifyDonor(ID),
  deleteDonor: () => actions.deleteDonor(ID),
  resendEmail: () => actions.resendEmail(ID),
  updateEvent: () => actions.updateEvent(prev, fd({ nameAr: "a", nameEn: "b" })),
  updateQueueStart: () => actions.updateQueueStart(prev, fd({ queue_start: "250" })),
  updateStatusLabels: () => actions.updateStatusLabels(prev, fd({ label_waiting: "Desk" })),
  updateTheme: () => actions.updateTheme(prev, fd({ theme_accent: "#093f4c", theme_background: "#fbf7f2" })),
  updateOgImage: () => actions.updateOgImage(prev, new FormData()),
  removeOgImage: () => actions.removeOgImage(),
  createSlot: () => actions.createSlot(prev, fd({ time: "14:00", capacity: "10" })),
  updateSlot: () => actions.updateSlot({ slotId: 1, capacity: 5, active: true }),
  deleteSlot: () => actions.deleteSlot(1),
  addAdmin: () =>
    actions.addAdmin(
      prev,
      fd({ email: "new@example.org", displayName: "New", password: "NewPassw0rd!x", confirm: "NewPassw0rd!x" }),
    ),
  changePassword: () => actions.changePassword(prev, fd({ password: "NewPassw0rd!x", confirm: "NewPassw0rd!x" })),
};

const MUTATING = /\.(insert|update|delete)$|^rpc\.|^auth\.updateUser$/;

beforeEach(() => {
  vi.clearAllMocks();
  h.calls.length = 0;
  h.user = null;
  h.adminRow = null;
});

describe("every exported admin action is covered by this test", () => {
  it("lists every export of actions.ts", () => {
    const exported = Object.keys(actions).filter((k) => typeof (actions as Record<string, unknown>)[k] === "function");
    const open = new Set(["signIn", "signOut"]); // the login and logout actions are intentionally public
    const missing = exported.filter((k) => !open.has(k) && !(k in guarded));
    expect(missing).toEqual([]);
  });
});

describe.each(Object.entries(guarded))("%s", (name, call) => {
  it("rejects an unauthenticated caller and writes nothing", async () => {
    h.user = null;
    await expect(call()).rejects.toMatchObject({ to: "/admin/login" });
    expect(h.calls.filter((c) => MUTATING.test(c))).toEqual([]);
    expect(h.sendDonorEmail).not.toHaveBeenCalled();
    expect(h.createAdmin).not.toHaveBeenCalled();
    void name;
  });
  it("rejects a signed-in non-admin, signs them out and writes nothing", async () => {
    h.user = { id: "u-stranger" };
    h.adminRow = null;
    await expect(call()).rejects.toMatchObject({ to: "/admin/login?error=not_admin" });
    expect(h.calls).toContain("auth.signOut");
    expect(h.calls.filter((c) => MUTATING.test(c))).toEqual([]);
    expect(h.sendDonorEmail).not.toHaveBeenCalled();
    expect(h.createAdmin).not.toHaveBeenCalled();
  });
});

describe("resendEmail for an admin", () => {
  it("sends and reports the outcome", async () => {
    h.user = { id: "u1" };
    h.adminRow = { display_name: "Admin" };
    h.sendDonorEmail.mockResolvedValue("sent");
    expect(await actions.resendEmail(ID)).toEqual({ ok: true, outcome: "sent" });
    expect(h.sendDonorEmail).toHaveBeenCalledWith(ID);
  });
  it("reports queued (budget exhausted) as not ok", async () => {
    h.user = { id: "u1" };
    h.adminRow = { display_name: "Admin" };
    h.sendDonorEmail.mockResolvedValue("queued");
    expect(await actions.resendEmail(ID)).toEqual({ ok: false, outcome: "queued" });
  });
  it("rejects a non-uuid id without sending", async () => {
    h.user = { id: "u1" };
    h.adminRow = { display_name: "Admin" };
    expect((await actions.resendEmail("nope")).ok).toBe(false);
    expect(h.sendDonorEmail).not.toHaveBeenCalled();
  });
});

describe("GET /admin/export with the real requireAdmin", () => {
  it("401 for unauthenticated", async () => {
    const res = await exportCsv();
    expect(res.status).toBe(401);
    expect(await res.text()).not.toContain("cpr");
    expect(h.calls.some((c) => c.startsWith("donors."))).toBe(false);
  });
  it("401 for a non-admin and never reads donors", async () => {
    h.user = { id: "stranger" };
    const res = await exportCsv();
    expect(res.status).toBe(401);
    expect(h.calls.some((c) => c.startsWith("donors."))).toBe(false);
  });
  it("200 for an admin", async () => {
    h.user = { id: "u1" };
    h.adminRow = { display_name: "A" };
    expect((await exportCsv()).status).toBe(200);
  });
});
