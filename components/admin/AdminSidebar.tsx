"use client";

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Dialog } from "radix-ui";
import {
  CalendarDays,
  Clock,
  Download,
  Droplet,
  LayoutDashboard,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Printer,
  Settings,
  UserPlus,
  X,
} from "lucide-react";
import { signOut } from "@/app/admin/actions";
import { ADMIN_NAV, SIDEBAR_COLLAPSED_KEY, isNavActive, parseCollapsed, type AdminNavItem } from "@/lib/admin-nav";

const ICONS: Record<AdminNavItem["icon"], typeof Menu> = {
  dashboard: LayoutDashboard,
  add: UserPlus,
  print: Printer,
  slots: Clock,
  event: CalendarDays,
  settings: Settings,
  export: Download,
};

const SIDEBAR_EVENT = "admin-sidebar";

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function subscribe(cb: () => void): () => void {
  window.addEventListener("storage", cb);
  window.addEventListener(SIDEBAR_EVENT, cb);
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener(SIDEBAR_EVENT, cb);
  };
}

const itemCls =
  "relative flex min-h-10 w-full items-center gap-3 rounded-lg px-3 text-sm font-medium text-ink-soft transition-colors hover:bg-paper-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand aria-[current=page]:bg-brand-tint aria-[current=page]:text-brand-dark aria-[current=page]:before:absolute aria-[current=page]:before:inset-y-2 aria-[current=page]:before:start-0 aria-[current=page]:before:w-1 aria-[current=page]:before:rounded-full aria-[current=page]:before:bg-brand motion-reduce:transition-none";

function NavList({
  pathname,
  collapsed,
  onNavigate,
}: {
  pathname: string;
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  return (
    <ul className="space-y-1">
      {ADMIN_NAV.map((item) => {
        const Icon = ICONS[item.icon];
        const active = isNavActive(pathname, item.href);
        const content = (
          <>
            <Icon className="size-5 shrink-0" aria-hidden="true" />
            <span className={collapsed ? "sr-only" : "truncate"}>{item.label}</span>
          </>
        );
        return (
          <li key={item.href}>
            {item.download ? (
              // The route answers with a CSV download, so it is a plain link that is never prefetched.
              <a href={item.href} title={collapsed ? item.label : undefined} onClick={onNavigate} className={itemCls}>
                {content}
              </a>
            ) : (
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                title={collapsed ? item.label : undefined}
                onClick={onNavigate}
                className={itemCls}
              >
                {content}
              </Link>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "")).toUpperCase();
}

function UserBlock({ displayName, collapsed }: { displayName: string; collapsed: boolean }) {
  return (
    <div className="space-y-2 border-t border-line p-3">
      <div className="flex items-center gap-3">
        {collapsed ? (
          <>
            <span
              aria-hidden="true"
              className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-tint text-xs font-bold text-brand-dark"
            >
              {initials(displayName)}
            </span>
            <span className="sr-only">{displayName}</span>
          </>
        ) : (
          <>
            <span
              aria-hidden="true"
              className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-tint text-xs font-bold text-brand-dark"
            >
              {initials(displayName)}
            </span>
            <span className="min-w-0 truncate text-sm text-ink-soft">{displayName}</span>
          </>
        )}
      </div>
      <form action={signOut}>
        <button type="submit" title={collapsed ? "Sign out" : undefined} className={itemCls + " hover:text-danger"}>
          <LogOut className="size-5 shrink-0" aria-hidden="true" />
          <span className={collapsed ? "sr-only" : "truncate"}>Sign out</span>
        </button>
      </form>
    </div>
  );
}

export function AdminSidebar({ displayName }: { displayName: string }) {
  const pathname = usePathname();
  const collapsed = useSyncExternalStore(
    subscribe,
    () => parseCollapsed(safeGet(SIDEBAR_COLLAPSED_KEY)),
    () => false,
  );
  const [drawerOpen, setDrawerOpen] = useState(false);

  function toggle() {
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? "0" : "1");
      window.dispatchEvent(new Event(SIDEBAR_EVENT));
    } catch {
      // Storage can be blocked; the sidebar then simply is not remembered.
    }
  }

  return (
    <>
      <aside
        data-collapsed={collapsed || undefined}
        aria-label="Admin"
        className="no-print sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-e border-line bg-white transition-[width] duration-200 data-[collapsed]:w-16 motion-reduce:transition-none lg:flex"
      >
        <div className="flex h-14 items-center gap-2 px-3">
          <Droplet className="size-5 shrink-0 fill-crimson text-crimson" aria-hidden="true" />
          <span className={collapsed ? "sr-only" : "truncate font-bold text-ink"}>Organiser console</span>
          <button
            type="button"
            onClick={toggle}
            aria-expanded={!collapsed}
            aria-controls="admin-nav"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="ms-auto inline-flex size-9 shrink-0 items-center justify-center rounded-lg hover:bg-paper-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            {collapsed ? <PanelLeftOpen className="size-5" aria-hidden="true" /> : <PanelLeftClose className="size-5" aria-hidden="true" />}
          </button>
        </div>
        <nav id="admin-nav" aria-label="Admin" className="flex-1 overflow-y-auto px-2 py-2">
          <NavList pathname={pathname} collapsed={collapsed} />
        </nav>
        <UserBlock displayName={displayName} collapsed={collapsed} />
      </aside>

      <div className="no-print sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-white px-3 lg:hidden">
        <Dialog.Root open={drawerOpen} onOpenChange={setDrawerOpen}>
          <Dialog.Trigger asChild>
            <button
              type="button"
              aria-label="Open menu"
              aria-expanded={drawerOpen}
              aria-controls="admin-drawer"
              className="inline-flex size-11 items-center justify-center rounded-lg hover:bg-paper-2 focus-visible:outline-2 focus-visible:outline-brand"
            >
              <Menu className="size-6" aria-hidden="true" />
            </button>
          </Dialog.Trigger>
          <Dialog.Portal>
            <Dialog.Overlay className="no-print fixed inset-0 z-40 bg-ink/40 data-[state=closed]:animate-out data-[state=closed]:fade-out data-[state=open]:animate-in data-[state=open]:fade-in motion-reduce:animate-none" />
            <Dialog.Content
              id="admin-drawer"
              aria-describedby={undefined}
              className="no-print fixed inset-y-0 start-0 z-50 flex w-72 max-w-[85vw] flex-col bg-white shadow-xl data-[state=closed]:animate-out data-[state=closed]:slide-out-to-left data-[state=open]:animate-in data-[state=open]:slide-in-from-left motion-reduce:animate-none"
            >
              <Dialog.Title className="sr-only">Admin navigation</Dialog.Title>
              <div className="flex h-14 items-center gap-2 px-3">
                <Droplet className="size-5 shrink-0 fill-crimson text-crimson" aria-hidden="true" />
                <span className="truncate font-bold text-ink">Organiser console</span>
                <Dialog.Close
                  aria-label="Close menu"
                  className="ms-auto inline-flex size-11 items-center justify-center rounded-lg hover:bg-paper-2 focus-visible:outline-2 focus-visible:outline-brand"
                >
                  <X className="size-5" aria-hidden="true" />
                </Dialog.Close>
              </div>
              <nav aria-label="Admin" className="flex-1 overflow-y-auto px-2 py-2">
                <NavList pathname={pathname} collapsed={false} onNavigate={() => setDrawerOpen(false)} />
              </nav>
              <UserBlock displayName={displayName} collapsed={false} />
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
        <Droplet className="size-5 shrink-0 fill-crimson text-crimson" aria-hidden="true" />
        <span className="font-bold text-ink">Organiser console</span>
      </div>
    </>
  );
}
