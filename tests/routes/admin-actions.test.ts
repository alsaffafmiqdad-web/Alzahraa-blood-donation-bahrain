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

import { checkInDonor, setDonorStatus, updateQueueStart, verifyDonor } from "@/app/admin/actions";

const ID = "11111111-2222-4333-8444-555555555555";

beforeEach(() => {
  vi.clearAllMocks();
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
