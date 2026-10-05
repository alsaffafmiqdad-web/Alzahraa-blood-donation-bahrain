"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { formatClock } from "@/lib/format";
import { Button } from "@/components/ui/button";

const STORAGE_KEY = "alz-admin-autorefresh";
const INTERVAL_MS = 60_000;

// Per-device preference kept in localStorage, read through useSyncExternalStore (SSR-safe, default off).
const listeners = new Set<() => void>();
function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}
const getSnapshot = () => window.localStorage.getItem(STORAGE_KEY) === "1";
const getServerSnapshot = () => false;

export function AutoRefresh() {
  const router = useRouter();
  const on = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const [updated, setUpdated] = useState(() => formatClock(new Date()));

  useEffect(() => {
    if (!on) return;
    const id = window.setInterval(() => {
      if (document.hidden) return;
      if (document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]')) return;
      router.refresh();
      setUpdated(formatClock(new Date()));
    }, INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [on, router]);

  function refreshNow() {
    router.refresh();
    setUpdated(formatClock(new Date()));
  }

  function toggle(next: boolean) {
    window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
    listeners.forEach((l) => l());
  }

  return (
    <div className="flex items-center gap-3 text-sm">
      <Button type="button" variant="outline" size="sm" onClick={refreshNow}>
        <RefreshCw className="size-4" aria-hidden="true" />
        Refresh
      </Button>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={on} onChange={(e) => toggle(e.target.checked)} className="size-4 accent-brand" />
        Auto-refresh (60s)
      </label>
      <span className="text-ink-soft" suppressHydrationWarning>
        Last updated {updated}
      </span>
    </div>
  );
}
