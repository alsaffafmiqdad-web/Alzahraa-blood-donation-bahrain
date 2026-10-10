import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ requireAdmin: vi.fn(), getStatusLabels: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireAdmin: h.requireAdmin }));
vi.mock("@/lib/db/status-labels", () => ({ getStatusLabels: h.getStatusLabels }));
vi.mock("next/navigation", () => ({ redirect: () => undefined, notFound: () => undefined }));

import { GET } from "@/app/admin/export/route";
import { DEFAULT_STATUS_LABELS } from "@/lib/status-labels";
import { pagedSupabase } from "../helpers/paged-supabase";

const donor = {
  id: "abcdef12-3456-4890-8bcd-ef1234567890",
  full_name: "=cmd|' /C calc'!A0",
  cpr: "990101123",
  phone: "33334444",
  email: "a@x.com",
  dob: "1990-01-01",
  blood_type: "O+",
  source: "self_signup",
  status: "registered",
  queue_number: null,
  checked_in_at: null,
  flagged: true,
  flag_reasons: ["on_medication"],
  q_recent_donation: false,
  q_on_medication: true,
  notes: "علي",
  email_sent: false,
  created_at: "2026-10-03T10:00:00Z",
  slots: { starts_at: "09:30:00" },
};

beforeEach(() => {
  vi.clearAllMocks();
  h.getStatusLabels.mockResolvedValue(DEFAULT_STATUS_LABELS);
});

/**
 * The Status cell of the one data row: the cell right after "Slot" (09:30) and before the queue number.
 * Other cells of the fixture hold no commas, so a plain split on the quoted cell boundaries is enough.
 */
async function statusCell(status: string): Promise<string> {
  h.requireAdmin.mockResolvedValue({
    supabase: pagedSupabase([{ ...donor, status }]).supabase,
    userId: "u",
    displayName: "A",
  });
  const body = await (await GET()).text();
  const m = /"09:30",("[^"]*"|[^,]*),/.exec(body);
  return (m?.[1] ?? "").replace(/^"|"$/g, "");
}

describe("CSV Status column uses the admin labels", () => {
  it("writes the label, never the raw key", async () => {
    expect(await statusCell("waiting")).toBe("Registration Station");
  });
  it("uses a custom label returned by the loader", async () => {
    h.getStatusLabels.mockResolvedValue({ ...DEFAULT_STATUS_LABELS, waiting: "Desk A" });
    expect(await statusCell("waiting")).toBe("Desk A");
  });
  it("falls back to the default when the loader result lacks a label", async () => {
    h.getStatusLabels.mockResolvedValue({ ...DEFAULT_STATUS_LABELS, no_show: undefined });
    expect(await statusCell("no_show")).toBe("No show (after half time)");
  });
  it("keeps the raw key only for an unknown status", async () => {
    expect(await statusCell("mystery")).toBe("mystery");
  });
});

describe("GET /admin/export", () => {
  it("returns 401 JSON for a non-admin", async () => {
    h.requireAdmin.mockRejectedValue(new Error("NEXT_REDIRECT"));
    const res = await GET();
    expect(res.status).toBe(401);
    expect(res.headers.get("content-type")).toContain("application/json");
  });
  it("returns a CSV attachment for an admin, with the full CPR and a formula guard", async () => {
    h.requireAdmin.mockResolvedValue({
      supabase: pagedSupabase([donor]).supabase,
      userId: "u",
      displayName: "A",
    });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename="donors-\d{4}-\d{2}-\d{2}\.csv"$/);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]); // UTF-8 BOM
    const body = new TextDecoder().decode(bytes);
    expect(body).toContain('"990101123"');
    expect(body).toContain(`"'=cmd`);
    expect(body).toContain("علي");
    expect(body).not.toContain("Feeling well");
    expect(body).not.toContain("Recent travel");
  });
  it("exports past the 1000 row PostgREST cap by paging with .range()", async () => {
    const many = Array.from({ length: 2500 }, (_, i) => ({
      ...donor,
      id: `abcdef12-3456-4890-8bcd-${String(i).padStart(12, "0")}`,
      full_name: `Donor ${i}`,
      cpr: String(100000000 + i),
    }));
    const { supabase, requests } = pagedSupabase(many);
    h.requireAdmin.mockResolvedValue({ supabase, userId: "u", displayName: "A" });
    const body = await (await GET()).text();
    expect(requests).toEqual([
      { from: 0, to: 999 },
      { from: 1000, to: 1999 },
      { from: 2000, to: 2999 },
    ]);
    expect(body).toContain('"Donor 0"');
    expect(body).toContain('"Donor 2499"');
    expect(body.trim().split("\r\n")).toHaveLength(2501); // header + 2500 rows
  });
  it("exactly one full page still asks for a second (empty) page, losing nothing", async () => {
    const exact = Array.from({ length: 1000 }, (_, i) => ({ ...donor, full_name: `E${i}`, cpr: String(200000000 + i) }));
    const { supabase, requests } = pagedSupabase(exact);
    h.requireAdmin.mockResolvedValue({ supabase, userId: "u", displayName: "A" });
    const body = await (await GET()).text();
    expect(requests).toHaveLength(2);
    expect(body.trim().split("\r\n")).toHaveLength(1001);
  });
});
