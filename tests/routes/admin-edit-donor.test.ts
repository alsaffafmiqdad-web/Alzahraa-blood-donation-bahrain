import { beforeEach, describe, expect, it, vi } from "vitest";

class RedirectError extends Error {
  constructor(public to: string) {
    super(`NEXT_REDIRECT:${to}`);
  }
}

const h = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
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
      c.select = () => c;
      c.eq = () => c;
      c.maybeSingle = async () => ({ data: table === "donors" ? h.current : null, error: null });
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
  it("a full CPR becomes its last 4 digits", async () => {
    const to = await go({ q: "990101123", status: "all" });
    expect(to).toBe("/admin?q=1123");
    expect(to).not.toContain("990101123");
  });
  it("Arabic digits and separators are recognised as a CPR too", async () => {
    expect(await go({ q: "٩٩٠-١٠١ ١٢٣" })).toBe("/admin?q=1123");
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
  });
});
