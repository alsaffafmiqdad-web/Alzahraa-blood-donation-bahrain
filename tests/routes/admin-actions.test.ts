import { beforeEach, describe, expect, it, vi } from "vitest";

class RedirectError extends Error {
  constructor(public to: string) {
    super(`NEXT_REDIRECT:${to}`);
  }
}

const h = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  rpc: vi.fn(),
  updates: [] as { table: string; values: unknown }[],
  sendDonorEmail: vi.fn(),
  revalidatePath: vi.fn(),
  getStatusLabels: vi.fn(),
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
vi.mock("@/lib/db/status-labels", () => ({ getStatusLabels: h.getStatusLabels }));
vi.mock("@/lib/auth", () => ({ requireAdmin: h.requireAdmin }));
vi.mock("@/lib/email/dispatch", () => ({ sendDonorEmail: h.sendDonorEmail }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: vi.fn() }));

function fakeSupabase() {
  const chain = (table: string, values: unknown) => {
    const c: Record<string, unknown> = {};
    c.eq = () => c;
    c.select = () => Promise.resolve({ data: [{ id: "x" }], error: null });
    h.updates.push({ table, values });
    return c;
  };
  return {
    rpc: h.rpc,
    from: (table: string) => ({
      update: (values: unknown) => chain(table, values),
    }),
  };
}

import {
  checkInDonor,
  removeOgImage,
  setDonorStatus,
  updateOgImage,
  updateQueueStart,
  updateStatusLabels,
  updateTheme,
  verifyDonor,
} from "@/app/admin/actions";
import { DEFAULT_STATUS_LABELS } from "@/lib/status-labels";

const ID = "11111111-2222-4333-8444-555555555555";

beforeEach(() => {
  vi.clearAllMocks();
  h.getStatusLabels.mockResolvedValue({ ...DEFAULT_STATUS_LABELS, deferred: "On Hold" });
  h.updates.length = 0;
  h.requireAdmin.mockResolvedValue({ supabase: fakeSupabase(), userId: "u1", displayName: "Admin" });
  h.rpc.mockResolvedValue({ data: [{ queue_number: 4, already_checked_in: false, status: "waiting" }], error: null });
});

describe("checkInDonor", () => {
  it("calls the check_in_donor rpc and returns the queue number", async () => {
    const res = await checkInDonor(ID);
    expect(h.rpc).toHaveBeenCalledWith("check_in_donor", { p_donor_id: ID });
    expect(res).toEqual({ ok: true, queueNumber: 4, alreadyCheckedIn: false, status: "waiting" });
  });
  it("passes through an already-checked-in result", async () => {
    h.rpc.mockResolvedValue({ data: [{ queue_number: 2, already_checked_in: true, status: "screening" }], error: null });
    expect(await checkInDonor(ID)).toEqual({ ok: true, queueNumber: 2, alreadyCheckedIn: true, status: "screening" });
  });
  it("rejects a non-uuid id without calling the rpc", async () => {
    const res = await checkInDonor("not-a-uuid");
    expect(res.ok).toBe(false);
    expect(h.rpc).not.toHaveBeenCalled();
  });
  it("reports an rpc error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    h.rpc.mockResolvedValue({ data: null, error: { message: "not_found" } });
    expect(await checkInDonor(ID)).toEqual({ ok: false, error: "Donor not found" });
  });
  it("does nothing when unauthenticated", async () => {
    h.requireAdmin.mockRejectedValue(new RedirectError("/admin/login"));
    await expect(checkInDonor(ID)).rejects.toBeInstanceOf(RedirectError);
    expect(h.rpc).not.toHaveBeenCalled();
  });
});

describe("setDonorStatus", () => {
  it("delegates waiting to check-in and never sends a plain update", async () => {
    const res = await setDonorStatus({ donorId: ID, status: "waiting" });
    expect(res.ok).toBe(true);
    expect(h.rpc).toHaveBeenCalledWith("check_in_donor", { p_donor_id: ID });
    expect(h.updates).toEqual([]);
  });
  it("waiting on a deferred donor returns the check-in error text with the admin label", async () => {
    h.rpc.mockResolvedValue({ data: [{ queue_number: null, already_checked_in: true, status: "deferred" }], error: null });
    const res = await setDonorStatus({ donorId: ID, status: "waiting" });
    expect(res).toEqual({
      ok: false,
      error: "This donor is On Hold and cannot be checked in. Change the status first if they are cleared to donate.",
    });
    expect(h.getStatusLabels).toHaveBeenCalled();
  });
  it("does a plain update for donated", async () => {
    const res = await setDonorStatus({ donorId: ID, status: "donated" });
    expect(res.ok).toBe(true);
    expect(h.updates).toEqual([{ table: "donors", values: { status: "donated" } }]);
    expect(h.rpc).not.toHaveBeenCalled();
  });
  it("rejects an unknown status and a bad id", async () => {
    expect((await setDonorStatus({ donorId: ID, status: "bogus" as never })).ok).toBe(false);
    expect((await setDonorStatus({ donorId: "x", status: "donated" })).ok).toBe(false);
    expect(h.updates).toEqual([]);
  });
  it("does nothing when unauthenticated", async () => {
    h.requireAdmin.mockRejectedValue(new RedirectError("/admin/login"));
    await expect(setDonorStatus({ donorId: ID, status: "donated" })).rejects.toBeInstanceOf(RedirectError);
    expect(h.updates).toEqual([]);
  });
});

describe("verifyDonor", () => {
  it("only moves registered donors to verified", async () => {
    const res = await verifyDonor(ID);
    expect(res.ok).toBe(true);
    expect(h.updates).toEqual([{ table: "donors", values: { status: "verified" } }]);
  });
});

describe("updateQueueStart", () => {
  const prev = { ok: false } as never;
  const fd = (v: string) => {
    const f = new FormData();
    f.set("queue_start", v);
    return f;
  };
  function withUpdate(error: { message: string } | null) {
    const eq = vi.fn().mockResolvedValue({ error });
    const update = vi.fn(() => ({ eq }));
    const from = vi.fn(() => ({ update }));
    h.requireAdmin.mockResolvedValue({ supabase: { from }, userId: "u1", displayName: "Admin" });
    return { eq, update, from };
  }
  it("saves a valid start on the event row", async () => {
    const m = withUpdate(null);
    expect(await updateQueueStart(prev, fd("250"))).toEqual({ ok: true, message: "Queue start saved" });
    expect(m.from).toHaveBeenCalledWith("event");
    expect(m.update).toHaveBeenCalledWith({ queue_start: 250 });
    expect(m.eq).toHaveBeenCalledWith("id", true);
  });
  it("rejects 0 without a DB call", async () => {
    const m = withUpdate(null);
    const res = await updateQueueStart(prev, fd("0"));
    expect(res.ok).toBe(false);
    expect(res.fieldErrors?.queue_start).toBeTruthy();
    expect(m.from).not.toHaveBeenCalled();
  });
  it("returns a generic error when the update fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    withUpdate({ message: "boom" });
    expect(await updateQueueStart(prev, fd("5"))).toMatchObject({ ok: false, error: "Could not save the queue start" });
  });
});

describe("updateStatusLabels", () => {
  const prev = { ok: false } as never;
  const keys = ["registered", "verified", "waiting", "screening", "donated", "deferred", "no_show"];
  const valid = () => {
    const f = new FormData();
    keys.forEach((k, i) => f.set(`label_${k}`, `  Name ${i}  `));
    return f;
  };
  function withLabels(failWith?: { message: string; code?: string }) {
    const calls: { values: unknown; col: string; val: unknown }[] = [];
    const from = vi.fn(() => ({
      update: (values: unknown) => ({
        eq: async (col: string, val: unknown) => {
          calls.push({ values, col, val });
          return { error: failWith ?? null };
        },
      }),
    }));
    h.requireAdmin.mockResolvedValue({ supabase: { from }, userId: "u1", displayName: "Admin" });
    return { calls, from };
  }

  it("updates seven rows with trimmed values and revalidates the admin layout", async () => {
    const m = withLabels();
    expect(await updateStatusLabels(prev, valid())).toEqual({ ok: true, message: "Status names saved" });
    expect(m.from).toHaveBeenCalledWith("status_labels");
    expect(m.calls).toHaveLength(7);
    expect(m.calls.map((c) => c.val).sort()).toEqual([...keys].sort());
    expect(m.calls.find((c) => c.val === "registered")!.values).toEqual({ label: "Name 0" });
    expect(h.revalidatePath).toHaveBeenCalledWith("/admin", "layout");
  });
  it("returns field errors for invalid input and writes nothing", async () => {
    const m = withLabels();
    const f = valid();
    f.set("label_waiting", "");
    f.set("label_donated", "A–B");
    const res = await updateStatusLabels(prev, f);
    expect(res.ok).toBe(false);
    expect(res.fieldErrors?.label_waiting).toBe("Enter a name");
    expect(res.fieldErrors?.label_donated).toBe("Don't use long dashes");
    expect(m.from).not.toHaveBeenCalled();
  });
  it("maps a unique violation to the duplicate message", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    withLabels({ message: "dup", code: "23505" });
    expect(await updateStatusLabels(prev, valid())).toMatchObject({ ok: false, error: "Each status needs a different name" });
  });
  it("returns a generic error on other failures", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    withLabels({ message: "boom" });
    expect(await updateStatusLabels(prev, valid())).toMatchObject({ ok: false, error: "Could not save the status names" });
  });
});

describe("updateTheme", () => {
  const prev = { ok: false } as never;
  const fd = (accent: string, background: string) => {
    const f = new FormData();
    f.set("theme_accent", accent);
    f.set("theme_background", background);
    return f;
  };
  function withEvent(error: { message: string } | null = null) {
    const eq = vi.fn().mockResolvedValue({ error });
    const update = vi.fn(() => ({ eq }));
    const from = vi.fn(() => ({ update }));
    h.requireAdmin.mockResolvedValue({ supabase: { from }, userId: "u1", displayName: "Admin" });
    return { eq, update, from };
  }
  it("saves the normalised colours", async () => {
    const m = withEvent();
    expect(await updateTheme(prev, fd("#093F4C", "#FBF7F2"))).toEqual({ ok: true, message: "Colours saved" });
    expect(m.from).toHaveBeenCalledWith("event");
    expect(m.update).toHaveBeenCalledWith({ theme_accent: "#093f4c", theme_background: "#fbf7f2" });
    expect(m.eq).toHaveBeenCalledWith("id", true);
    expect(h.revalidatePath).toHaveBeenCalledWith("/admin/event");
    expect(h.revalidatePath).toHaveBeenCalledWith("/", "layout");
  });
  it("returns field errors and writes nothing", async () => {
    const m = withEvent();
    const res = await updateTheme(prev, fd("#ffff00", "#222222"));
    expect(res.ok).toBe(false);
    expect(res.fieldErrors?.theme_accent).toBe("The accent colour is too light for white button text");
    expect(res.fieldErrors?.theme_background).toBe("The background is too dark for the text");
    expect(m.from).not.toHaveBeenCalled();
  });
  it("returns a generic error when the update fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    withEvent({ message: "boom" });
    expect(await updateTheme(prev, fd("#093f4c", "#fbf7f2"))).toMatchObject({ ok: false, error: "Could not save the colours" });
  });
});

describe("updateOgImage and removeOgImage", () => {
  const prev = { ok: false } as never;
  const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4];
  const WEBP = [...Buffer.from("RIFF"), 0, 0, 0, 0, ...Buffer.from("WEBP")];
  const fdFile = (bytes: number[] | Uint8Array, name = "x.png") => {
    const f = new FormData();
    f.set("og_image", new File([new Uint8Array(bytes)], name));
    return f;
  };
  function withStorage(opts: { oldPath?: string | null; updateError?: boolean; uploadError?: boolean } = {}) {
    const upload = vi.fn().mockResolvedValue({ error: opts.uploadError ? { message: "up" } : null });
    const remove = vi.fn().mockResolvedValue({ error: null });
    const updateEq = vi.fn().mockResolvedValue({ error: opts.updateError ? { message: "db" } : null });
    const update = vi.fn(() => ({ eq: updateEq }));
    const select = vi.fn(() => ({
      eq: () => ({ maybeSingle: async () => ({ data: { og_image_path: opts.oldPath ?? null }, error: null }) }),
    }));
    const storageFrom = vi.fn(() => ({ upload, remove }));
    const from = vi.fn(() => ({ select, update }));
    h.requireAdmin.mockResolvedValue({ supabase: { from, storage: { from: storageFrom } }, userId: "u1", displayName: "Admin" });
    return { upload, remove, update, from, storageFrom };
  }

  it("rejects a missing or empty file", async () => {
    const m = withStorage();
    expect(await updateOgImage(prev, new FormData())).toMatchObject({ ok: false, error: "Choose a JPG or PNG image" });
    expect(await updateOgImage(prev, fdFile([]))).toMatchObject({ ok: false, error: "Choose a JPG or PNG image" });
    expect(m.upload).not.toHaveBeenCalled();
  });
  it("rejects an oversize file", async () => {
    const m = withStorage();
    const big = new Uint8Array(900_001);
    big.set(PNG);
    expect(await updateOgImage(prev, fdFile(big))).toMatchObject({ ok: false, error: "The image must be 900 KB or smaller" });
    expect(m.upload).not.toHaveBeenCalled();
  });
  it("rejects webp bytes and renamed non-images, whatever the file name says", async () => {
    const m = withStorage();
    expect(await updateOgImage(prev, fdFile(WEBP, "x.png"))).toMatchObject({ ok: false, error: "Choose a JPG or PNG image" });
    expect(await updateOgImage(prev, fdFile([1, 2, 3, 4, 5, 6, 7, 8, 9], "x.jpg"))).toMatchObject({
      ok: false,
      error: "Choose a JPG or PNG image",
    });
    expect(m.upload).not.toHaveBeenCalled();
  });
  it("uploads PNG bytes to og/<13 digits>.png, saves the path and removes the old object afterwards", async () => {
    const m = withStorage({ oldPath: "og/1700000000000.jpg" });
    expect(await updateOgImage(prev, fdFile(PNG))).toEqual({ ok: true, message: "Link preview image saved" });
    expect(m.storageFrom).toHaveBeenCalledWith("site-assets");
    const [path, , options] = m.upload.mock.calls[0]!;
    expect(path).toMatch(/^og\/\d{13}\.png$/);
    expect(options).toEqual({ contentType: "image/png", upsert: false, cacheControl: "31536000" });
    expect(m.update).toHaveBeenCalledWith({ og_image_path: path });
    expect(m.remove).toHaveBeenCalledTimes(1);
    expect(m.remove).toHaveBeenCalledWith(["og/1700000000000.jpg"]);
    expect(h.revalidatePath).toHaveBeenCalledWith("/", "layout");
  });
  it("removes the new object when the row update fails, and keeps the old one", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const m = withStorage({ oldPath: "og/1700000000000.jpg", updateError: true });
    expect(await updateOgImage(prev, fdFile(PNG))).toMatchObject({ ok: false, error: "Could not save the image" });
    const uploaded = m.upload.mock.calls[0]![0] as string;
    expect(m.remove).toHaveBeenCalledTimes(1);
    expect(m.remove).toHaveBeenCalledWith([uploaded]);
  });
  it("a failed upload leaves the current image in place", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const m = withStorage({ oldPath: "og/1700000000000.jpg", uploadError: true });
    expect(await updateOgImage(prev, fdFile(PNG))).toMatchObject({ ok: false, error: "Could not save the image" });
    expect(m.update).not.toHaveBeenCalled();
    expect(m.remove).not.toHaveBeenCalled();
  });
  it("removeOgImage clears the path, then removes the old object", async () => {
    const m = withStorage({ oldPath: "og/1700000000000.png" });
    expect(await removeOgImage()).toEqual({ ok: true });
    expect(m.update).toHaveBeenCalledWith({ og_image_path: null });
    expect(m.remove).toHaveBeenCalledWith(["og/1700000000000.png"]);
    expect(h.revalidatePath).toHaveBeenCalledWith("/", "layout");
  });
  it("removeOgImage keeps the object when the row update fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const m = withStorage({ oldPath: "og/1700000000000.png", updateError: true });
    expect(await removeOgImage()).toMatchObject({ ok: false });
    expect(m.remove).not.toHaveBeenCalled();
  });
});
