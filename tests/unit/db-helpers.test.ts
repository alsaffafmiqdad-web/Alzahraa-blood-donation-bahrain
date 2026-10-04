import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  upload: vi.fn(),
  remove: vi.fn(),
  eq: vi.fn(),
  update: vi.fn(),
  createUser: vi.fn(),
  deleteUser: vi.fn(),
  insert: vi.fn(),
  clientOpts: [] as unknown[],
}));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: (opts?: unknown) => {
    h.clientOpts.push(opts);
    return {
      storage: { from: () => ({ upload: h.upload, remove: h.remove }) },
      auth: { admin: { createUser: h.createUser, deleteUser: h.deleteUser } },
      from: () => ({ update: h.update, insert: h.insert }),
    };
  },
}));

import { attachCprImage, CPR_IMAGE_CLEANUP_DEADLINE_MS, CPR_IMAGE_DEADLINE_MS } from "@/lib/db/cpr-image";
import { createAdmin } from "@/lib/db/admins";

const ID = "abcdef12-3456-4890-8bcd-ef1234567890";
beforeEach(() => {
  vi.clearAllMocks();
  h.clientOpts.length = 0;
  vi.spyOn(console, "error").mockImplementation(() => {});
  h.upload.mockResolvedValue({ error: null });
  h.remove.mockResolvedValue({ error: null });
  h.eq.mockResolvedValue({ error: null });
  h.update.mockReturnValue({ eq: h.eq });
  h.createUser.mockResolvedValue({ data: { user: { id: "u9" } }, error: null });
  h.deleteUser.mockResolvedValue({ error: null });
  h.insert.mockResolvedValue({ error: null });
});

describe("attachCprImage", () => {
  it("uploads with the sniffed content type, no upsert, then records the path", async () => {
    expect(await attachCprImage(ID, new Uint8Array([1]), "png")).toBe(true);
    expect(h.upload).toHaveBeenCalledWith(`${ID}/cpr.png`, expect.anything(), { contentType: "image/png", upsert: false });
    expect(h.update).toHaveBeenCalledWith({ cpr_image_path: `${ID}/cpr.png` });
    expect(h.eq).toHaveBeenCalledWith("id", ID);
    expect(h.clientOpts).toEqual([{ deadlineMs: CPR_IMAGE_DEADLINE_MS }]);
  });
  it("returns false (never throws) when the upload fails, and does not update the row", async () => {
    h.upload.mockResolvedValue({ error: { message: "boom" } });
    expect(await attachCprImage(ID, new Uint8Array([1]), "jpg")).toBe(false);
    expect(h.update).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining(`cpr image error donor=${ID}`));
  });
  it("removes the stored object when the row update fails", async () => {
    h.eq.mockResolvedValue({ error: { message: "rls" } });
    expect(await attachCprImage(ID, new Uint8Array([1]), "jpg")).toBe(false);
    expect(h.remove).toHaveBeenCalledWith([`${ID}/cpr.jpg`]);
    expect(h.clientOpts).toEqual([{ deadlineMs: CPR_IMAGE_DEADLINE_MS }, { deadlineMs: CPR_IMAGE_CLEANUP_DEADLINE_MS }]);
  });
  it("still returns false without throwing when the cleanup remove rejects", async () => {
    h.eq.mockResolvedValue({ error: { message: "rls" } });
    h.remove.mockRejectedValue(new Error("aborted"));
    await expect(attachCprImage(ID, new Uint8Array([1]), "jpg")).resolves.toBe(false);
  });
  it("returns false and logs on a timeout-style rejection", async () => {
    h.upload.mockRejectedValue(Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" }));
    expect(await attachCprImage(ID, new Uint8Array([1]), "jpg")).toBe(false);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining(`cpr image error donor=${ID}`));
  });
  it("returns false even when the client itself throws", async () => {
    h.upload.mockRejectedValue(new Error("network"));
    expect(await attachCprImage(ID, new Uint8Array([1]), "jpg")).toBe(false);
  });
});

describe("createAdmin", () => {
  const input = { email: "a@b.org", password: "super-secret-pass-1", displayName: "A" };
  it("creates a confirmed user and the admins row", async () => {
    expect(await createAdmin(input)).toEqual({ ok: true });
    expect(h.createUser).toHaveBeenCalledWith({ email: "a@b.org", password: input.password, email_confirm: true });
    expect(h.insert).toHaveBeenCalledWith({ user_id: "u9", display_name: "A" });
  });
  it("email_exists is not promoted", async () => {
    h.createUser.mockResolvedValue({ data: { user: null }, error: { code: "email_exists", message: "x" } });
    expect(await createAdmin(input)).toEqual({ ok: false, reason: "email_exists" });
    expect(h.insert).not.toHaveBeenCalled();
    expect(h.deleteUser).not.toHaveBeenCalled();
  });
  it("rolls back via deleteUser when the insert fails, without logging email or password", async () => {
    h.insert.mockResolvedValue({ error: { message: "fk" } });
    expect(await createAdmin(input)).toEqual({ ok: false, reason: "failed" });
    expect(h.deleteUser).toHaveBeenCalledWith("u9");
    const logged = JSON.stringify((console.error as unknown as { mock: { calls: unknown[] } }).mock.calls);
    expect(logged).not.toContain(input.email);
    expect(logged).not.toContain(input.password);
  });
  it("logs a failed rollback and still reports failed", async () => {
    h.insert.mockResolvedValue({ error: { message: "fk" } });
    h.deleteUser.mockResolvedValue({ error: { message: "cannot delete" } });
    expect(await createAdmin(input)).toEqual({ ok: false, reason: "failed" });
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("rollback deleteUser failed"));
  });
});
