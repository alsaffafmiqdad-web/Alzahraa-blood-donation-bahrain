import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ client: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: h.client }));

import { getSignupSummary } from "@/lib/db/signup-summary";

const ID = "abcdef12-3456-4890-8bcd-ef1234567890";

/** A fake client: `.select("status")` ends in maybeSingle, `.select("id", {head})` resolves to the count. */
function fake(row: unknown, count: unknown) {
  return {
    from: () => ({
      select: (cols: string) =>
        cols === "status"
          ? { eq: () => ({ maybeSingle: async () => row }) }
          : Promise.resolve(count),
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("getSignupSummary", () => {
  it("returns the status and the total", async () => {
    h.client.mockReturnValue(fake({ data: { status: "waiting" }, error: null }, { count: 12, error: null }));
    expect(await getSignupSummary(ID)).toEqual({ status: "waiting", total: 12 });
  });
  it("leaves total out when the count fails, and logs no personal data", async () => {
    h.client.mockReturnValue(fake({ data: { status: "registered" }, error: null }, { count: null, error: { message: "boom" } }));
    expect(await getSignupSummary(ID)).toEqual({ status: "registered" });
    expect(String(vi.mocked(console.error).mock.calls[0]?.[0])).toContain(ID);
  });
  it("leaves status out for an unknown value or an error", async () => {
    h.client.mockReturnValue(fake({ data: { status: "mystery" }, error: null }, { count: 3, error: null }));
    expect(await getSignupSummary(ID)).toEqual({ total: 3 });
    h.client.mockReturnValue(fake({ data: null, error: { message: "x" } }, { count: 3, error: null }));
    expect(await getSignupSummary(ID)).toEqual({ total: 3 });
  });
  it("never throws", async () => {
    h.client.mockImplementation(() => {
      throw new Error("no env");
    });
    expect(await getSignupSummary(ID)).toEqual({});
  });
});
