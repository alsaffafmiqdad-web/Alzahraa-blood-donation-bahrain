import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ rpc: vi.fn(), maybeSingle: vi.fn(), eq: vi.fn(), select: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    rpc: h.rpc,
    from: () => ({ select: h.select.mockReturnValue({ eq: h.eq.mockReturnValue({ maybeSingle: h.maybeSingle }) }) }),
  }),
}));

import { findSubmission, registerDonor, type RegisterDonorInput } from "@/lib/db/public";

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

describe("submission id", () => {
  it("passes p_submission_id, null when absent", async () => {
    h.rpc.mockResolvedValue({ data: ID, error: null });
    await registerDonor({ ...input, slotId: 3 });
    expect(h.rpc.mock.calls[0]![1]).toMatchObject({ p_submission_id: null });
    await registerDonor({ ...input, slotId: 3, submissionId: ID });
    expect(h.rpc.mock.calls[1]![1]).toMatchObject({ p_submission_id: ID });
  });
  it("findSubmission maps the columns and filters on submission_id only", async () => {
    h.maybeSingle.mockResolvedValue({
      data: { id: ID, cpr: "990101123", slot_id: 3, queue_number: null, email: "a@b.c", email_sent: true, cpr_image_path: "x/y.jpg" },
      error: null,
    });
    expect(await findSubmission(ID)).toEqual({
      id: ID, cpr: "990101123", slotId: 3, queueNumber: null, email: "a@b.c", emailSent: true, hasImage: true,
    });
    expect(h.eq).toHaveBeenCalledWith("submission_id", ID);
  });
  it("findSubmission returns null when nothing matches and throws on error", async () => {
    h.maybeSingle.mockResolvedValue({ data: null, error: null });
    expect(await findSubmission(ID)).toBeNull();
    h.maybeSingle.mockResolvedValue({ data: null, error: { message: "boom" } });
    await expect(findSubmission(ID)).rejects.toThrow("boom");
  });
});
