"use client";

import type { RefObject } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";

gsap.registerPlugin(useGSAP);

/** Animates the [data-active-step] element inside `scope` whenever `key` changes after a user navigation. */
export function useStepTransition(
  scope: RefObject<HTMLElement | null>,
  key: string,
  shiftPx: number,
  enabled: () => boolean,
): void {
  useGSAP(
    () => {
      if (!enabled()) return;
      const el = scope.current?.querySelector<HTMLElement>("[data-active-step]");
      if (!el) return;
      const mm = gsap.matchMedia();
      mm.add("(prefers-reduced-motion: no-preference)", () => {
        gsap.fromTo(
          el,
          { opacity: 0, x: shiftPx },
          { opacity: 1, x: 0, duration: 0.28, ease: "power2.out", clearProps: "opacity,transform" },
        );
      });
      return () => mm.revert();
    },
    { scope, dependencies: [key], revertOnUpdate: true },
  );
}
