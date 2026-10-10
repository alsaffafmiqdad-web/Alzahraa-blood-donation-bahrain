import { describe, expect, it } from "vitest";
import { checkInNotice } from "@/lib/check-in-notice";
import { DEFAULT_STATUS_LABELS, type StatusLabels } from "@/lib/status-labels";

const labels: StatusLabels = { ...DEFAULT_STATUS_LABELS, deferred: "On Hold", screening: "Desk B", donated: "Done" };

describe("checkInNotice", () => {
  it("success with the real queue number", () => {
    expect(checkInNotice("Ali", { ok: true, queueNumber: 7, alreadyCheckedIn: false, status: "waiting" }, labels)).toEqual({
      kind: "success",
      text: "Ali checked in, queue #7",
    });
  });
  it("already waiting is an info message with the existing number", () => {
    expect(checkInNotice("Ali", { ok: true, queueNumber: 3, alreadyCheckedIn: true, status: "waiting" }, labels)).toEqual({
      kind: "info",
      text: "Ali is already checked in, queue #3",
    });
  });
  it("a refused deferred donor is an error that says why, using the admin label, with no queue number", () => {
    const n = checkInNotice("Ali", { ok: true, queueNumber: null, alreadyCheckedIn: true, status: "deferred" }, labels);
    expect(n.kind).toBe("error");
    expect(n.text).toBe(
      "Ali is On Hold and cannot be checked in. Change the status first if they are cleared to donate.",
    );
    expect(n.text).not.toMatch(/queue|null|#/i);
  });
  it.each([
    ["screening", "Desk B"],
    ["donated", "Done"],
  ] as const)("a %s donor is refused as an error with the admin label, never success", (status, label) => {
    const n = checkInNotice("Ali", { ok: true, queueNumber: 5, alreadyCheckedIn: true, status }, labels);
    expect(n.kind).toBe("error");
    expect(n.text).toBe(`Ali's status is already ${label}, so check-in does not apply.`);
    expect(n.text).not.toContain("queue #");
  });
  it("passes a server error through unchanged", () => {
    expect(checkInNotice("Ali", { ok: false, error: "Donor not found" }, labels)).toEqual({
      kind: "error",
      text: "Donor not found",
    });
  });
  it("never produces the text 'null' for any combination", () => {
    for (const status of ["registered", "verified", "waiting", "screening", "donated", "deferred", "no_show"] as const) {
      for (const already of [true, false]) {
        const n = checkInNotice("Ali", { ok: true, queueNumber: null, alreadyCheckedIn: already, status }, labels);
        expect(n.text).not.toContain("null");
        expect(n.text).not.toContain("undefined");
      }
    }
  });
});
