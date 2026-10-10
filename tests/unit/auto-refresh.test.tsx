import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));

import { AutoRefresh } from "@/components/admin/AutoRefresh";

describe("AutoRefresh", () => {
  const html = renderToStaticMarkup(<AutoRefresh />);
  it("renders the idle button and a polite status region", () => {
    expect(html).toContain("Refresh");
    expect(html).not.toContain("Refreshing...");
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("Last updated");
    expect(html).toContain('aria-busy="false"');
    expect(html).not.toContain("animate-spin");
  });
});

describe("AutoRefresh source", () => {
  const src = readFileSync("components/admin/AutoRefresh.tsx", "utf8");
  it("wraps both refresh sites in a transition and shows progress", () => {
    expect(src).toContain("useTransition");
    expect(src.match(/startTransition\(/g)).toHaveLength(2);
    expect(src).toContain("Refreshing...");
    expect(src).toContain("animate-spin motion-reduce:animate-none");
    expect(src).toContain("disabled={pending}");
    expect(src).toContain("aria-busy={pending}");
  });
  it("toasts only after a manual refresh", () => {
    expect(src.match(/toast\.success\("Dashboard updated"\)/g)).toHaveLength(1);
    expect(src).toMatch(/manual\.current = true/);
    expect(src).toMatch(/if \(manual\.current\) \{/);
  });
  it("stamps the time when the refresh finishes, not when it starts", () => {
    expect(src).toMatch(/if \(wasPending && !pending\) \{\s*setUpdated\(formatClock\(new Date\(\)\)\)/);
  });
  it("keeps the hidden-tab and open-dialog skips", () => {
    expect(src).toContain("document.hidden");
    expect(src).toContain('[role="alertdialog"][data-state="open"]');
  });
});
