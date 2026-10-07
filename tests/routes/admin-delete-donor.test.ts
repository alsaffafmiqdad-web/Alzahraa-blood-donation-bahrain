import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  imagePath: null as string | null,
  removed: [] as string[][],
  removeError: null as { message: string } | null,
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
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/auth", () => ({ requireAdmin: h.requireAdmin }));
vi.mock("@/lib/email/dispatch", () => ({ sendDonorEmail: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: vi.fn() }));

const fakeSupabase = {
  from: () => {
    const c: Record<string, unknown> = {};
    c.select = () => c;
    c.eq = () => c;
    c.maybeSingle = async () => ({ data: { cpr_image_path: h.imagePath }, error: null });
    c.delete = () => ({ eq: async () => ({ error: null }) });
    return c;
  },
  storage: {
    from: () => ({
      remove: async (paths: string[]) => {
        h.removed.push(paths);
        return { error: h.removeError };
      },
    }),
  },
};

import { deleteDonor } from "@/app/admin/actions";

const ID = "11111111-2222-4333-8444-555555555555";

beforeEach(() => {
  vi.clearAllMocks();
  h.removed.length = 0;
  h.imagePath = null;
  h.removeError = null;
  h.requireAdmin.mockResolvedValue({ supabase: fakeSupabase });
});

describe("deleteDonor", () => {
  it("removes every possible photo path even when cpr_image_path is null", async () => {
    expect(await deleteDonor(ID)).toEqual({ ok: true });
    expect(h.removed).toEqual([[`${ID}/cpr.jpg`, `${ID}/cpr.png`, `${ID}/cpr.webp`]]);
  });
  it("does not repeat the stored path", async () => {
    h.imagePath = `${ID}/cpr.png`;
    await deleteDonor(ID);
    expect(h.removed).toEqual([[`${ID}/cpr.png`, `${ID}/cpr.jpg`, `${ID}/cpr.webp`]]);
  });
  it("still succeeds when the storage remove fails", async () => {
    h.removeError = { message: "boom" };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await deleteDonor(ID)).toEqual({ ok: true });
    spy.mockRestore();
  });
});
