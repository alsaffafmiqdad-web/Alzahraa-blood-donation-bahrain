import { describe, expect, it } from "vitest";
import { fetchAllRows } from "@/lib/db/paginate";
import { pagedSupabase } from "../helpers/paged-supabase";

type Q = { range: (a: number, b: number) => Promise<{ data: unknown[] | null; error: { message: string } | null }> };

const run = (rows: unknown[], pageSize?: number, opts?: Parameters<typeof pagedSupabase>[1]) => {
  const { supabase, requests } = pagedSupabase(rows, opts);
  return fetchAllRows((from, to) => (supabase.from() as unknown as Q).range(from, to), pageSize).then((r) => ({
    ...r,
    requests,
  }));
};

describe("fetchAllRows", () => {
  it("returns an empty list for no rows with one request", async () => {
    const r = await run([]);
    expect(r.data).toEqual([]);
    expect(r.requests).toHaveLength(1);
  });
  it("walks past the 1000 row server cap", async () => {
    const rows = Array.from({ length: 2345 }, (_, i) => i);
    const r = await run(rows);
    expect(r.data).toEqual(rows);
    expect(r.requests.map((x) => x.from)).toEqual([0, 1000, 2000]);
  });
  it("a smaller page size still returns everything exactly once", async () => {
    const rows = Array.from({ length: 25 }, (_, i) => i);
    const r = await run(rows, 10);
    expect(r.data).toEqual(rows);
  });
  it("returns the error and the rows read so far", async () => {
    const r = await run([1, 2, 3], undefined, { error: { message: "boom" } });
    expect(r.error?.message).toBe("boom");
    expect(r.data).toEqual([]);
  });
});
