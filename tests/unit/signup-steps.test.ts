import { describe, expect, it } from "vitest";
import { errorsForStep, photoRequired, signupSteps, stepOfField } from "@/lib/signup-steps";

describe("signup steps", () => {
  it("slot mode has 8 steps in order", () => {
    expect(signupSteps(false)).toEqual(["slot", "name", "identity", "contact", "bloodType", "photo", "screening", "review"]);
  });
  it("walk-in mode drops the slot step but keeps the photo", () => {
    const steps = signupSteps(true);
    expect(steps).toHaveLength(7);
    expect(steps).not.toContain("slot");
    expect(steps).toContain("photo");
  });
  it("maps fields to steps", () => {
    expect(stepOfField("cpr", false)).toBe("identity");
    expect(stepOfField("dob", true)).toBe("identity");
    expect(stepOfField("cprImage", false)).toBe("photo");
    expect(stepOfField("consent", false)).toBe("review");
    expect(stepOfField("slotId", false)).toBe("slot");
    expect(stepOfField("slotId", true)).toBeNull();
    expect(stepOfField("nope", false)).toBeNull();
  });
  it("filters errors to the step's fields", () => {
    const errors = { cpr: "cpr_invalid", dob: "dob_required", phone: "phone_invalid" };
    expect(errorsForStep(errors, "identity")).toEqual({ cpr: "cpr_invalid", dob: "dob_required" });
    expect(errorsForStep(errors, "name")).toEqual({});
  });
  it("requires the photo only in slot mode", () => {
    expect(photoRequired(false)).toBe(true);
    expect(photoRequired(true)).toBe(false);
  });
});
