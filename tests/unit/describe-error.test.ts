import { describe, expect, it } from "vitest";
import { describeError } from "@/lib/describe-error";

function undiciError() {
  const inner = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:54321"), {
    code: "ECONNREFUSED",
    errno: -61,
    syscall: "connect",
    address: "127.0.0.1",
    port: 54321,
  });
  return new TypeError("fetch failed", { cause: inner });
}

describe("describeError", () => {
  it("adds a nested undici-style cause with code, syscall, address and port", () => {
    expect(describeError(undiciError())).toBe("fetch failed (cause: ECONNREFUSED connect 127.0.0.1:54321)");
  });
  it("walks at most 3 levels of cause", () => {
    const e = new Error("a", { cause: new Error("b", { cause: new Error("c", { cause: new Error("d", { cause: new Error("e") }) }) }) });
    expect(describeError(e)).toBe("a (cause: b (cause: c (cause: d)))");
  });
  it("keeps the code of a wrapped error from a database client", () => {
    const wrapped = new Error("slot_availability failed: TypeError: fetch failed", {
      cause: { message: "TypeError: fetch failed", details: "TypeError: fetch failed\n at x {cause: connect ECONNREFUSED 127.0.0.1:54321}", code: "" },
    });
    expect(describeError(wrapped)).toContain("(cause: ECONNREFUSED)");
  });
  it("handles a string, null, undefined, numbers and plain objects", () => {
    expect(describeError("boom")).toBe("boom");
    expect(describeError(null)).toBe("unknown");
    expect(describeError(undefined)).toBe("unknown");
    expect(describeError(42)).toBe("unknown");
    expect(describeError({ message: "from object" })).toBe("from object");
    expect(describeError({})).toBe("unknown");
  });
  it("does not loop on a circular cause", () => {
    const a: Error & { cause?: unknown } = new Error("a");
    const b: Error & { cause?: unknown } = new Error("b");
    a.cause = b;
    b.cause = a;
    expect(describeError(a)).toBe("a (cause: b)");
    const self = new Error("self");
    (self as Error & { cause?: unknown }).cause = self;
    expect(describeError(self)).toBe("self");
  });
  it("does not throw when a property getter throws", () => {
    const evil = {
      get message(): string {
        throw new Error("nope");
      },
    };
    expect(() => describeError(evil)).not.toThrow();
  });
});
