/* Isomorphic and pure: the admin navigation model. */

export type AdminNavItem = {
  href: string;
  label: string;
  icon: "dashboard" | "add" | "print" | "slots" | "event" | "settings" | "export";
  download?: true;
};

export const ADMIN_NAV: readonly AdminNavItem[] = [
  { href: "/admin", label: "Dashboard", icon: "dashboard" },
  { href: "/admin/donors/new", label: "Add donor", icon: "add" },
  { href: "/admin/print", label: "Print", icon: "print" },
  { href: "/admin/slots", label: "Slots", icon: "slots" },
  { href: "/admin/event", label: "Event", icon: "event" },
  { href: "/admin/account", label: "Settings", icon: "settings" },
  { href: "/admin/export", label: "Export", icon: "export", download: true },
];

export const SIDEBAR_COLLAPSED_KEY = "admin-sidebar-collapsed";

export function isNavActive(pathname: string, href: string): boolean {
  if (href === "/admin/export") return false;
  if (href === "/admin") {
    if (pathname === "/admin") return true;
    return pathname.startsWith("/admin/donors/") && !/^\/admin\/donors\/new(\/|$)/.test(pathname);
  }
  return pathname === href || pathname.startsWith(href + "/");
}

export function parseCollapsed(raw: string | null): boolean {
  return raw === "1";
}
