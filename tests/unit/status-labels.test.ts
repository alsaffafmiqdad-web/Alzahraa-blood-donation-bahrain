import { describe, expect, it } from "vitest";
import { STATUSES } from "@/lib/config";
import { DEFAULT_STATUS_LABELS, isValidStatusLabel, resolveStatusLabels } from "@/lib/status-labels";

const EN_DASH = String.fromCharCode(0x2013);
const EM_DASH = String.fromCharCode(0x2014);

describe("isValidStatusLabel", () => {
  it("accepts a normal label", () => {
    expect(isValidStatusLabel("Doctor Station")).toBe(true);
    expect(isValidStatusLabel("x".repeat(40))).toBe(true);
  });
  it.each([
    ["empty", ""],
    ["untrimmed", "  x"],
    ["trailing space", "x "],
    ["41 characters", "x".repeat(41)],
    ["an en dash", `A${EN_DASH}B`],
    ["an em dash", `A${EM_DASH}B`],
    ["a number", 5],
    ["null", null],
  ])("rejects %s", (_name, value) => {
    expect(isValidStatusLabel(value)).toBe(false);
  });
});

describe("resolveStatusLabels", () => {
  const rows = STATUSES.map((s) => ({ status: s, label: `Custom ${s}` }));
  it("maps full rows through unchanged", () => {
    const out = resolveStatusLabels(rows);
    for (const s of STATUSES) expect(out[s]).toBe(`Custom ${s}`);
  });
  it("falls back for a missing row", () => {
    const out = resolveStatusLabels(rows.filter((r) => r.status !== "no_show"));
    expect(out.no_show).toBe("No show (after half time)");
    expect(out.waiting).toBe("Custom waiting");
  });
  it("falls back for an empty or invalid label", () => {
    const out = resolveStatusLabels([
      { status: "waiting", label: "" },
      { status: "screening", label: "x".repeat(41) },
      { status: "donated", label: `A${EM_DASH}B` },
    ]);
    expect(out.waiting).toBe(DEFAULT_STATUS_LABELS.waiting);
    expect(out.screening).toBe(DEFAULT_STATUS_LABELS.screening);
    expect(out.donated).toBe(DEFAULT_STATUS_LABELS.donated);
  });
  it("ignores an unknown status row", () => {
    const out = resolveStatusLabels([{ status: "bogus", label: "Nope" }]);
    expect(out).toEqual(DEFAULT_STATUS_LABELS);
    expect(out).not.toHaveProperty("bogus");
  });
  it("does not trust prototype keys", () => {
    expect(resolveStatusLabels([{ status: "constructor", label: "x" }])).toEqual(DEFAULT_STATUS_LABELS);
  });
  it("null or undefined gives the defaults", () => {
    expect(resolveStatusLabels(null)).toEqual(DEFAULT_STATUS_LABELS);
    expect(resolveStatusLabels(undefined)).toEqual(DEFAULT_STATUS_LABELS);
  });
});

describe("DEFAULT_STATUS_LABELS", () => {
  it("matches the seeded station names", () => {
    expect(DEFAULT_STATUS_LABELS).toEqual({
      registered: "Registered",
      verified: "Verified (before the event)",
      waiting: "Registration Station",
      screening: "Doctor Station",
      donated: "Donation Reception",
      deferred: "Deferred",
      no_show: "No show (after half time)",
    });
  });
  it("has the same names as the migration seed", async () => {
    const { readFileSync } = await import("node:fs");
    const sql = readFileSync("supabase/migrations/20261008000000_theme_og_whatsapp_status_labels.sql", "utf8");
    for (const [status, label] of Object.entries(DEFAULT_STATUS_LABELS)) {
      expect(sql).toContain(`('${status}','${label}')`);
    }
  });
});
