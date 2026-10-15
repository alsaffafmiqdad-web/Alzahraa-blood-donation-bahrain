import { describe, expect, it } from "vitest";
import { isEmailAuthError } from "@/lib/email/errors";

describe("isEmailAuthError", () => {
  it.each(["smtp EAUTH 534: Invalid login: ...", "smtp EAUTH 535: bad login", "smtp EAUTH: nope"])("is true for %s", (e) => {
    expect(isEmailAuthError(e)).toBe(true);
  });
  it.each(["smtp ETIMEDOUT: timeout", "smtp error: unknown", "", "boom", "domain not verified", "x smtp EAUTH 535"])(
    "is false for %j",
    (e) => {
      expect(isEmailAuthError(e)).toBe(false);
    },
  );
});
