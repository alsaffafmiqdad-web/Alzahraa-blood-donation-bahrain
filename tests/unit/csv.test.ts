import { describe, expect, it } from "vitest";
import { toCsv } from "@/lib/csv";

describe("toCsv", () => {
  it("starts with a BOM and uses CRLF", () => {
    const out = toCsv(["a", "b"], [["x", "y"]]);
    expect(out.startsWith("﻿")).toBe(true);
    expect(out).toContain("\r\n");
  });
  it("guards against formula injection", () => {
    const out = toCsv(["c"], [['=HYPERLINK("x")'], ["+1"], ["-1"], ["@x"], ["\tx"]]);
    expect(out).toContain(`"'=HYPERLINK(""x"")"`);
    expect(out).toContain(`"'+1"`);
    expect(out).toContain(`"'-1"`);
    expect(out).toContain(`"'@x"`);
  });
  it("leaves blood types alone", () => {
    const out = toCsv(["c"], [["A-"], ["O+"]]);
    expect(out).toContain('"A-"');
    expect(out).toContain('"O+"');
    expect(out).not.toContain("'A-");
  });
  it("quotes numbers and keeps Arabic", () => {
    const out = toCsv(["c"], [[5], ["علي حسن"], [null], [true]]);
    expect(out).toContain('"5"');
    expect(out).toContain("علي حسن");
    expect(out).toContain('""');
  });
});
