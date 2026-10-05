import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const motion = readFileSync("components/public/motion.ts", "utf8");

describe("motion", () => {
  it("imports only react, gsap and @gsap/react", () => {
    const specs = [...motion.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
    expect(specs.sort()).toEqual(["@gsap/react", "gsap", "react"]);
    expect(motion).not.toMatch(/from "gsap\//);
  });
  it("respects reduced motion and never animates visibility", () => {
    expect(motion).toContain("prefers-reduced-motion: no-preference");
    expect(motion).not.toContain("autoAlpha");
    expect(motion).not.toContain("visibility");
  });
  it("is used by the signup form", () => {
    expect(readFileSync("components/public/SignupForm.tsx", "utf8")).toContain("useStepTransition(");
  });
});
