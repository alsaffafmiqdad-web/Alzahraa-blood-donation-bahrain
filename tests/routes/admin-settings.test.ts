import { beforeEach, describe, expect, it, vi } from "vitest";

/** addAdmin / createAdmin and deleteDonor's CPR photo cleanup. */
class RedirectError extends Error {
  constructor(public to: string) {
    super(`NEXT_REDIRECT:${to}`);
  }
}

const h = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  revalidatePath: vi.fn(),
  createUser: vi.fn(),
  deleteUser: vi.fn(),
  adminsInsert: vi.fn(),
  remove: vi.fn(),
  donorPath: null as string | null,
  deleteError: null as { message: string } | null,
}));

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new RedirectError(to);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: h.revalidatePath }));
vi.mock("@/lib/auth", () => ({ requireAdmin: h.requireAdmin }));
vi.mock("@/lib/email/dispatch", () => ({ sendDonorEmail: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    auth: { admin: { createUser: h.createUser, deleteUser: h.deleteUser } },
    from: () => ({ insert: h.adminsInsert }),
  }),
}));

import { addAdmin, deleteDonor } from "@/app/admin/actions";

const ID = "11111111-2222-4333-8444-555555555555";
const prev = { ok: false } as never;
const fd = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};
const form = { email: " New@Example.org ", displayName: "New Admin", password: "a-long-password-1", confirm: "a-long-password-1" };

function userSupabase() {
  return {
    from: () => {
      const c: Record<string, unknown> = {};
      c.select = () => c;
      c.eq = () => c;
      c.maybeSingle = async () => ({ data: { cpr_image_path: h.donorPath }, error: null });
      c.delete = () => ({ eq: async () => ({ error: h.deleteError }) });
      return c;
    },
    storage: { from: () => ({ remove: h.remove }) },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  h.donorPath = null;
  h.deleteError = null;
  h.requireAdmin.mockResolvedValue({ supabase: userSupabase(), userId: "u1", displayName: "Admin" });
  h.createUser.mockResolvedValue({ data: { user: { id: "new-user" } }, error: null });
  h.deleteUser.mockResolvedValue({ error: null });
  h.adminsInsert.mockResolvedValue({ error: null });
  h.remove.mockResolvedValue({ error: null });
});

describe("addAdmin", () => {
  it("redirects a non-admin and never touches auth", async () => {
    h.requireAdmin.mockRejectedValue(new RedirectError("/admin/login"));
    await expect(addAdmin(prev, fd(form))).rejects.toBeInstanceOf(RedirectError);
    expect(h.createUser).not.toHaveBeenCalled();
  });
  it("returns field errors for invalid input without creating a user", async () => {
    const res = await addAdmin(prev, fd({ ...form, confirm: "nope" }));
    expect(res.ok).toBe(false);
    expect(res.fieldErrors?.confirm).toBe("Passwords do not match");
    expect(h.createUser).not.toHaveBeenCalled();
  });
  it("creates a confirmed user with a lowercased email, inserts the admin row and revalidates", async () => {
    const res = await addAdmin(prev, fd(form));
    expect(res.ok).toBe(true);
    expect(h.createUser).toHaveBeenCalledWith({
      email: "new@example.org",
      password: "a-long-password-1",
      email_confirm: true,
    });
    expect(h.adminsInsert).toHaveBeenCalledWith({ user_id: "new-user", display_name: "New Admin" });
    expect(h.revalidatePath).toHaveBeenCalledWith("/admin/account");
  });
  it("reports an existing email and never inserts an admin row", async () => {
    h.createUser.mockResolvedValue({ data: { user: null }, error: { code: "email_exists", message: "x" } });
    const res = await addAdmin(prev, fd(form));
    expect(res.ok).toBe(false);
    expect(res.fieldErrors?.email).toBe("An account with this email already exists.");
    expect(h.adminsInsert).not.toHaveBeenCalled();
    expect(h.deleteUser).not.toHaveBeenCalled();
  });
  it("also recognises the message form of the duplicate error", async () => {
    h.createUser.mockResolvedValue({
      data: { user: null },
      error: { message: "A user with this email address has already been registered" },
    });
    expect((await addAdmin(prev, fd(form))).fieldErrors?.email).toBeTruthy();
  });
  it("deletes the new auth user when the admins insert fails, and logs neither email nor password", async () => {
    h.adminsInsert.mockResolvedValue({ error: { message: "boom" } });
    const res = await addAdmin(prev, fd(form));
    expect(res).toEqual({ ok: false, error: "Could not add the admin. Please try again." });
    expect(h.deleteUser).toHaveBeenCalledWith("new-user");
    const logged = JSON.stringify((console.error as unknown as { mock: { calls: unknown[] } }).mock.calls);
    expect(logged).not.toContain("example.org");
    expect(logged).not.toContain("a-long-password-1");
  });
  it("returns a generic failure for other auth errors", async () => {
    h.createUser.mockResolvedValue({ data: { user: null }, error: { message: "weak password" } });
    const res = await addAdmin(prev, fd(form));
    expect(res).toEqual({ ok: false, error: "Could not add the admin. Please try again." });
    expect(h.adminsInsert).not.toHaveBeenCalled();
  });
});

describe("deleteDonor and the CPR photo", () => {
  it("removes the stored photo after deleting the row", async () => {
    h.donorPath = `${ID}/cpr.jpg`;
    expect(await deleteDonor(ID)).toEqual({ ok: true });
    expect(h.remove).toHaveBeenCalledWith([`${ID}/cpr.jpg`, `${ID}/cpr.png`, `${ID}/cpr.webp`]);
  });
  it("still removes every possible photo path when there is no stored path", async () => {
    expect(await deleteDonor(ID)).toEqual({ ok: true });
    expect(h.remove).toHaveBeenCalledWith([`${ID}/cpr.jpg`, `${ID}/cpr.png`, `${ID}/cpr.webp`]);
  });
  it("keeps the photo when the row delete fails", async () => {
    h.donorPath = `${ID}/cpr.jpg`;
    h.deleteError = { message: "nope" };
    expect((await deleteDonor(ID)).ok).toBe(false);
    expect(h.remove).not.toHaveBeenCalled();
  });
  it("still returns ok when the storage remove fails", async () => {
    h.donorPath = `${ID}/cpr.png`;
    h.remove.mockResolvedValue({ error: { message: "storage down" } });
    expect(await deleteDonor(ID)).toEqual({ ok: true });
  });
});
