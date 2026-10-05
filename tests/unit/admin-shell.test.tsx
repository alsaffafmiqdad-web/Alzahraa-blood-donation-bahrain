import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/admin/slots" }));
vi.mock("@/app/admin/actions", () => ({ signOut: async () => {} }));

import { AdminShell } from "@/components/admin/AdminShell";

const html = renderToStaticMarkup(
  <AdminShell displayName="Sara Ali">
    <p>content</p>
  </AdminShell>,
);

describe("AdminShell", () => {
  it("has a skip link and the main landmark", () => {
    expect(html).toContain('href="#main"');
    expect(html).toContain('id="main"');
  });
  it("labels the nav and marks only Slots as current", () => {
    expect(html).toContain('aria-label="Admin"');
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html).toMatch(/<a[^>]*aria-current="page"[^>]*href="\/admin\/slots"|<a[^>]*href="\/admin\/slots"[^>]*aria-current="page"/);
    expect(html).not.toMatch(/href="\/admin\/print"[^>]*aria-current|aria-current="page"[^>]*href="\/admin\/print"/);
  });
  it("links Export and has the toggle", () => {
    expect(html).toContain('href="/admin/export"');
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('aria-controls="admin-nav"');
  });
  it("hides chrome from print and has the mobile menu button", () => {
    expect(html).toMatch(/<aside[^>]*no-print/);
    expect(html).toMatch(/<div class="no-print sticky/);
    expect(html).toContain('aria-label="Open menu"');
  });
});
