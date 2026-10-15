import { beforeEach, describe, expect, it, vi } from "vitest";

class RedirectError extends Error {
  constructor(public to: string) {
    super(`NEXT_REDIRECT:${to}`);
  }
}

const h = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  eqCalls: [] as [string, unknown][],
  lookup: { data: { id: "11111111-2222-4333-8444-555555555555" } as unknown, error: null as unknown },
  current: { id: "x", source: "walk_in", email: null as string | null },
  updates: [] as Record<string, unknown>[],
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
vi.mock("@/lib/auth", () => ({ requireAdmin: h.requireAdmin }));
vi.mock("@/lib/email/dispatch", () => ({ sendDonorEmail: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: vi.fn() }));

function fakeSupabase() {
  return {
    from: (table: string) => {
      const c: Record<string, unknown> = {};
      let selected = "";
      c.select = (cols: string) => {
        selected = cols;
        return c;
      };
      c.eq = (col: string, val: unknown) => {
        h.eqCalls.push([col, val]);
        return c;
      };
      c.maybeSingle = async () => {
        if (table === "donors" && selected === "id" && h.eqCalls.some(([col]) => col === "cpr")) return h.lookup;
        return { data: table === "donors" ? h.current : null, error: null };
      };
      c.single = async () => ({ data: table === "event" ? { event_date: "2026-10-16" } : null, error: null });
      c.update = (values: Record<string, unknown>) => {
        h.updates.push(values);
        return { eq: async () => ({ error: null }) };
      };
      return c;
    },
  };
}

import { editDonor, searchDonors } from "@/app/admin/actions";

const ID = "11111111-2222-4333-8444-555555555555";
const fd = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};
const base = { id: ID, fullName: "Ali Hasan", cpr: "990101123", bloodType: "O+", recentDonation: "no", onMedication: "no" };
const edit = async (extra: Record<string, string>) => {
  await expect(editDonor({ ok: false }, fd({ ...base, ...extra }))).rejects.toBeInstanceOf(RedirectError);
};

beforeEach(() => {
  vi.clearAllMocks();
  h.updates.length = 0;
  h.eqCalls.length = 0;
  h.lookup = { data: { id: ID }, error: null };
  h.current = { id: ID, source: "walk_in", email: "old@example.com" };
  h.requireAdmin.mockResolvedValue({ supabase: fakeSupabase(), userId: "u1", displayName: "Admin" });
});

describe("editDonor email lifecycle (L3)", () => {
  it("a changed address resets email_sent, attempts, last error and last attempt", async () => {
    await edit({ email: "new@example.com" });
    expect(h.updates).toHaveLength(1);
    expect(h.updates[0]).toMatchObject({
      email: "new@example.com",
      email_sent: false,
      email_attempts: 0,
      email_last_error: null,
      email_last_attempt_at: null,
    });
  });
  it("an unchanged address does not touch the email bookkeeping", async () => {
    await edit({ email: "old@example.com" });
    expect(h.updates[0]).not.toHaveProperty("email_sent");
    expect(h.updates[0]).not.toHaveProperty("email_attempts");
  });
  it("a case-only change is not a new address", async () => {
    await edit({ email: "OLD@Example.com" });
    expect(h.updates[0]).not.toHaveProperty("email_sent");
  });
  it("adding an address to a donor who had none resets too", async () => {
    h.current.email = null;
    await edit({ email: "first@example.com" });
    expect(h.updates[0]).toMatchObject({ email_sent: false, email_attempts: 0 });
  });
  it("removing the address resets the bookkeeping too", async () => {
    await edit({ email: "" });
    expect(h.updates[0]).toMatchObject({ email: null, email_sent: false, email_attempts: 0 });
  });
});

describe("searchDonors (L6): the CPR never reaches the URL", () => {
  const go = async (o: Record<string, string>) => {
    try {
      await searchDonors(fd(o));
    } catch (e) {
      return (e as RedirectError).to;
    }
    throw new Error("no redirect");
  };
  it("a full CPR is looked up and the URL carries the donor id", async () => {
    const to = await go({ q: "990101123", status: "all" });
    expect(to).toBe(`/admin?donor=${ID}`);
    expect(to).not.toContain("990101123");
    expect(h.eqCalls).toContainEqual(["cpr", "990101123"]);
  });
  it.each(["٩٩٠-١٠١ ١٢٣", " 990 101 123 "])("a full CPR %j is normalised for the lookup", async (q) => {
    expect(await go({ q })).toBe(`/admin?donor=${ID}`);
    expect(h.eqCalls).toContainEqual(["cpr", "990101123"]);
  });
  it("keeps the other filters", async () => {
    expect(await go({ q: "990101123", status: "waiting", slot: "3", sort: "queue", flagged: "1" })).toBe(
      `/admin?donor=${ID}&status=waiting&slot=3&sort=queue&flagged=1`,
    );
  });
  it("no match goes to donor=none", async () => {
    h.lookup = { data: null, error: null };
    expect(await go({ q: "990101123" })).toBe("/admin?donor=none");
  });
  it("a lookup error goes to donor=error and never logs the CPR", async () => {
    h.lookup = { data: null, error: { message: "boom" } };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await go({ q: "990101123" })).toBe("/admin?donor=error");
    expect(spy).toHaveBeenCalled();
    expect(JSON.stringify(spy.mock.calls)).not.toContain("990101123");
    spy.mockRestore();
  });
  it("a forged donor field is ignored", async () => {
    expect(await go({ q: "Ali", donor: ID })).toBe("/admin?q=Ali");
  });
  it("partial digits stay a plain search with no lookup", async () => {
    expect(await go({ q: "1123" })).toBe("/admin?q=1123");
    expect(h.eqCalls.some(([col]) => col === "cpr")).toBe(false);
  });
  it("names and other filters pass through", async () => {
    expect(await go({ q: "Ali", status: "waiting", slot: "3", sort: "queue", flagged: "1" })).toBe(
      "/admin?q=Ali&status=waiting&slot=3&sort=queue&flagged=1",
    );
  });
  it("an empty search goes to the plain dashboard", async () => {
    expect(await go({ q: "", status: "all", source: "all", sort: "registration" })).toBe("/admin");
  });
  it("requires an admin", async () => {
    h.requireAdmin.mockRejectedValue(new RedirectError("/admin/login"));
    await expect(searchDonors(fd({ q: "x" }))).rejects.toMatchObject({ to: "/admin/login" });
    expect(h.eqCalls).toHaveLength(0);
  });
});
