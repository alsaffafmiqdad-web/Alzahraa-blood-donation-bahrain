import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireAdmin: h.requireAdmin }));
vi.mock("next/navigation", () => ({ redirect: () => undefined, notFound: () => undefined }));

import { GET } from "@/app/admin/export/route";
import { toCsv } from "@/lib/csv";

const base = {
  id: "abcdef12-3456-4890-8bcd-ef1234567890", full_name: "Ali", cpr: "990101123", phone: "33334444", email: "a@x.com",
  dob: "1990-01-01", blood_type: "O+", source: "self_signup", status: "registered", queue_number: null, checked_in_at: null,
  flagged: false, flag_reasons: [], q_recent_donation: false, q_on_medication: false, notes: null, email_sent: false,
  created_at: "2026-10-03T10:00:00Z", slots: null,
};
import { pagedSupabase } from "../helpers/paged-supabase";

beforeEach(() => vi.clearAllMocks());

function asAdmin(rows: unknown[]) {
  h.requireAdmin.mockResolvedValue({
    supabase: pagedSupabase(rows).supabase,
    userId: "u", displayName: "A",
  });
}

describe("CSV formula injection", () => {
  it("prefixes every dangerous leading character, including CR and TAB", () => {
    const out = toCsv(["c"], [["=1"], ["+1"], ["-1"], ["@a"], ["\ta"], ["\ra"]]);
    for (const needle of [`"'=1"`, `"'+1"`, `"'-1"`, `"'@a"`, `"'\ta"`, `"'\ra"`]) expect(out).toContain(needle);
  });
  it("escapes double quotes and keeps embedded newlines inside the quoted cell", () => {
    const out = toCsv(["c"], [['say "hi"\nnext']]);
    expect(out).toContain('"say ""hi""\nnext"');
  });
  it("route escapes name, phone, email and notes alike", async () => {
    asAdmin([{ ...base, full_name: "=SUM(1)", email: "@evil.com", notes: "+cmd|' /C calc'!A0", phone: "-1234" }]);
    const body = await (await GET()).text();
    expect(body).toContain(`"'=SUM(1)"`);
    expect(body).toContain(`"'@evil.com"`);
    expect(body).toContain(`"'+cmd|' /C calc'!A0"`);
    expect(body).toContain(`"'-1234"`);
    expect(body).not.toMatch(/(^|,)"[=+\-@]/m);
  });
  it("route only emits the two allowed screening columns", async () => {
    asAdmin([base]);
    const header = (await (await GET()).text()).split("\r\n")[0]!;
    expect(header).toContain("Recent donation");
    expect(header).toContain("On medication");
    expect(header).not.toMatch(/feel|travel|procedure|tattoo|surgery|piercing/i);
  });
  it("route returns 500 JSON (no data) when the query fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    h.requireAdmin.mockResolvedValue({
      supabase: pagedSupabase([], { error: { message: "x" } }).supabase,
      userId: "u", displayName: "A",
    });
    const res = await GET();
    expect(res.status).toBe(500);
  });
});
