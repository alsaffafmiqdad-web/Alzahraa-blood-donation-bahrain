"use client";

import { useEffect } from "react";

/** Opens the browser print dialog once the page has rendered (used by the dashboard's row Print button). */
export function AutoPrint() {
  useEffect(() => {
    const id = window.setTimeout(() => window.print(), 300);
    return () => window.clearTimeout(id);
  }, []);
  return null;
}
