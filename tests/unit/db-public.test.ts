import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => ({ rpc: h.rpc }) }));

import { registerDonor, type RegisterDonorInput } from "@/lib/db/public";

const ID = "abcdef12-3456-4890-8bcd-ef1234567890";
const input: RegisterDonorInput = {
  fullName: "Ali",
  cpr: "990101123",
  dob: "1990-05-05",
  phone: "33334444",
  bloodType: "O+",
  slotId: null,
  recentDonation: false,
  onMedication: false,
  flagged: false,
  flagReasons: [],
};

beforeEach(() => vi.clearAllMocks());

describe("registerDonor", () => {
  it("walk-in: reads the array row and calls register_walk_in_donor without p_slot_id", async () => {
    h.rpc.mockResolvedValue({ data: [{ donor_id: ID, queue_number: 5 }], error: null });
    expect(await registerDonor(input)).toEqual({ ok: true, id: ID, queueNumber: 5 });
    expect(h.rpc.mock.calls[0]![0]).toBe("register_walk_in_donor");
    expect(h.rpc.mock.calls[0]![1]).not.toHaveProperty("p_slot_id");
  });
  it("walk-in: accepts a single object row", async () => {
    h.rpc.mockResolvedValue({ data: { donor_id: ID, queue_number: 6 }, error: null });
    expect(await registerDonor(input)).toEqual({ ok: true, id: ID, queueNumber: 6 });
  });
  it("walk-in: throws on an empty result", async () => {
    h.rpc.mockResolvedValue({ data: [], error: null });
    await expect(registerDonor(input)).rejects.toThrow("register_walk_in_donor returned no id");
  });
  it("walk-in: maps duplicate_cpr", async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: "duplicate_cpr" } });
    expect(await registerDonor(input)).toEqual({ ok: false, reason: "duplicate_cpr" });
  });
  it("slot path: register_donor with a null queue number", async () => {
    h.rpc.mockResolvedValue({ data: ID, error: null });
    expect(await registerDonor({ ...input, slotId: 3 })).toEqual({ ok: true, id: ID, queueNumber: null });
    expect(h.rpc.mock.calls[0]![0]).toBe("register_donor");
    expect(h.rpc.mock.calls[0]![1]).toMatchObject({ p_slot_id: 3 });
  });
});
