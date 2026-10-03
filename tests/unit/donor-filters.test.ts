import { describe, expect, it } from "vitest";
import {
  computeStats,
  filterDonors,
  parseFilters,
  sortDonors,
  toListRow,
  urlSafeSearch,
  withRegistrationOrder,
  type DonorRecord,
} from "@/lib/donor-filters";
import { shortRef } from "@/lib/format";

function d(over: Partial<DonorRecord> & { id: string }): DonorRecord {
  return {
    full_name: "Name",
    cpr: "000000000",
    phone: null,
    email: null,
    blood_type: "unknown",
    slot_id: null,
    source: "self_signup",
    status: "registered",
    queue_number: null,
    flagged: false,
    flag_reasons: [],
    email_sent: false,
    created_at: "2026-10-01T10:00:00Z",
    ...over,
  };
}
const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "bbbbbbbb-0000-4000-8000-000000000002";
const C = "cccccccc-0000-4000-8000-000000000003";
const rows = [
  d({ id: A, full_name: "Ali Hasan", cpr: "990101123", phone: "33334444", slot_id: 2, created_at: "2026-10-01T10:02:00Z", queue_number: 2, status: "waiting", flagged: true, flag_reasons: ["on_medication"], email: "a@x.com" }),
  d({ id: B, full_name: "Zaid", cpr: "880202456", phone: "36665555", slot_id: 1, created_at: "2026-10-01T10:01:00Z", queue_number: 1, status: "donated", email: "b@x.com", email_sent: true }),
  d({ id: C, full_name: "Walkin Man", cpr: "770303789", slot_id: null, source: "walk_in", created_at: "2026-10-01T10:03:00Z" }),
];
const slots = new Map([[1, "08:30:00"], [2, "09:00:00"]]);
const numbered = withRegistrationOrder(rows);

describe("donor filters", () => {
  it("numbers by registration order", () => {
    expect(numbered.map((r) => [r.id, r.seq])).toEqual([[B, 1], [A, 2], [C, 3]]);
  });
  it("searches name case-insensitively, cpr substring, phone and ref", () => {
    expect(filterDonors(numbered, { q: "ALI" }).map((r) => r.id)).toEqual([A]);
    expect(filterDonors(numbered, { q: "0202" }).map((r) => r.id)).toEqual([B]);
    expect(filterDonors(numbered, { q: "3666" }).map((r) => r.id)).toEqual([B]);
    expect(filterDonors(numbered, { q: "#" + shortRef(C).toLowerCase() }).map((r) => r.id)).toEqual([C]);
  });
  it("filters by status, flagged, slot none, source", () => {
    expect(filterDonors(numbered, { status: "donated" }).map((r) => r.id)).toEqual([B]);
    expect(filterDonors(numbered, { status: "all" })).toHaveLength(3);
    expect(filterDonors(numbered, { flagged: true }).map((r) => r.id)).toEqual([A]);
    expect(filterDonors(numbered, { slot: "none" }).map((r) => r.id)).toEqual([C]);
    expect(filterDonors(numbered, { slot: "2" }).map((r) => r.id)).toEqual([A]);
    expect(filterDonors(numbered, { source: "walk_in" }).map((r) => r.id)).toEqual([C]);
  });
  it("sorts by registration, slot and queue with nulls last", () => {
    expect(sortDonors(numbered, "registration", slots).map((r) => r.id)).toEqual([B, A, C]);
    expect(sortDonors(numbered, "slot", slots).map((r) => r.id)).toEqual([B, A, C]);
    expect(sortDonors(numbered, "queue", slots).map((r) => r.id)).toEqual([B, A, C]);
    const reversed = [...numbered].reverse();
    expect(sortDonors(reversed, "queue", slots).at(-1)?.id).toBe(C);
  });
  it("computes stats", () => {
    const s = computeStats(rows);
    expect(s.total).toBe(3);
    expect(s.byStatus.waiting).toBe(1);
    expect(s.byStatus.donated).toBe(1);
    expect(s.flagged).toBe(1);
    expect(s.walkIns).toBe(1);
    expect(s.emailsPending).toBe(1);
  });
  it("list rows never contain the full cpr", () => {
    const row = toListRow(numbered[1]!, slots);
    expect(row).not.toHaveProperty("cpr");
    expect(row.cprMasked).toBe("*****1123");
    expect(JSON.stringify(row)).not.toContain("990101123");
    expect(row.slotTime).toBe("09:00:00");
  });
  it("parses filters and ignores junk", () => {
    expect(parseFilters({ status: "bogus", sort: "evil", slot: "x" })).toMatchObject({ status: undefined, sort: "registration", slot: undefined });
    expect(parseFilters({ flagged: "1", sort: "queue", status: "donated" })).toMatchObject({ flagged: true, sort: "queue", status: "donated" });
  });
});

describe("urlSafeSearch", () => {
  it("reduces a 9 digit CPR (any digit script, with spaces or hyphens) to its last 4 digits", () => {
    expect(urlSafeSearch("990101123")).toBe("1123");
    expect(urlSafeSearch(" 990-101-123 ")).toBe("1123");
    expect(urlSafeSearch("٩٩٠١٠١١٢٣")).toBe("1123");
  });
  it("leaves names, phones, refs and partial digits alone", () => {
    expect(urlSafeSearch("Ali Hasan")).toBe("Ali Hasan");
    expect(urlSafeSearch("33334444")).toBe("33334444");
    expect(urlSafeSearch("ABCDEF12")).toBe("ABCDEF12");
    expect(urlSafeSearch("1123")).toBe("1123");
    expect(urlSafeSearch("9901011234")).toBe("9901011234");
  });
});
