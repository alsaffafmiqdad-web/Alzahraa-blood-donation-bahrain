import { describe, expect, it } from "vitest";
import { ADMIN_NAV, isNavActive, parseCollapsed } from "@/lib/admin-nav";

describe("isNavActive", () => {
  it.each([
    ["/admin", "/admin", true],
    ["/admin/donors/abc", "/admin", true],
    ["/admin/donors/abc/edit", "/admin", true],
    ["/admin/donors/new", "/admin", false],
    ["/admin/donors/new", "/admin/donors/new", true],
    ["/admin/slots", "/admin/slots", true],
    ["/admin/slotsx", "/admin/slots", false],
    ["/admin/export", "/admin/export", false],
    ["/admin", "/admin/export", false],
  ])("%s vs %s", (path, href, expected) => {
    expect(isNavActive(path, href)).toBe(expected);
  });
  it("parseCollapsed", () => {
    expect(parseCollapsed("1")).toBe(true);
    expect(parseCollapsed("0")).toBe(false);
    expect(parseCollapsed(null)).toBe(false);
  });
  it("has the 7 items in order", () => {
    expect(ADMIN_NAV.map((n) => n.label)).toEqual(["Dashboard", "Add donor", "Print", "Slots", "Event", "Settings", "Export"]);
  });
});
