import { describe, expect, it } from "vitest";
import { checkInNotice } from "@/lib/check-in-notice";

describe("checkInNotice", () => {
  it("success with the real queue number", () => {
    expect(checkInNotice("Ali", { ok: true, queueNumber: 7, alreadyCheckedIn: false, status: "waiting" })).toEqual({
      kind: "success",
      text: "Ali checked in, queue #7",
    });
  });
  it("already waiting is an info message with the existing number", () => {
    expect(checkInNotice("Ali", { ok: true, queueNumber: 3, alreadyCheckedIn: true, status: "waiting" })).toEqual({
      kind: "info",
      text: "Ali is already checked in, queue #3",
    });
  });
  it("a refused deferred donor is an error that says why, with no queue number", () => {
    const n = checkInNotice("Ali", { ok: true, queueNumber: null, alreadyCheckedIn: true, status: "deferred" });
    expect(n.kind).toBe("error");
    expect(n.text).toContain("Deferred");
    expect(n.text).not.toMatch(/queue|null|#/i);
  });
  it.each(["screening", "donated"] as const)("a %s donor is refused as an error, never success", (status) => {
    const n = checkInNotice("Ali", { ok: true, queueNumber: 5, alreadyCheckedIn: true, status });
    expect(n.kind).toBe("error");
    expect(n.text).toContain("already");
    expect(n.text).not.toContain("queue #");
  });
  it("passes a server error through unchanged", () => {
    expect(checkInNotice("Ali", { ok: false, error: "Donor not found" })).toEqual({ kind: "error", text: "Donor not found" });
  });
  it("never produces the text 'null' for any combination", () => {
    for (const status of ["registered", "verified", "waiting", "screening", "donated", "deferred", "no_show"] as const) {
      for (const already of [true, false]) {
        const n = checkInNotice("Ali", { ok: true, queueNumber: null, alreadyCheckedIn: already, status });
        expect(n.text).not.toContain("null");
        expect(n.text).not.toContain("undefined");
      }
    }
  });
});
