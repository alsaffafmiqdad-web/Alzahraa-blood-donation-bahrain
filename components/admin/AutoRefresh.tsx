"use client";

import { useEffect, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
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
  const [pending, startTransition] = useTransition();
  const manual = useRef(false);

  // Stamp the time only once the refresh has finished (previous value kept in state, no effect).
  const [wasPending, setWasPending] = useState(false);
  if (wasPending !== pending) {
    setWasPending(pending);
    if (wasPending && !pending) {
      setUpdated(formatClock(new Date()));
    }
  }

  // Confirm a manual refresh (never the automatic one) once it has finished.
  useEffect(() => {
    if (pending) return;
    if (manual.current) {
      manual.current = false;
      toast.success("Dashboard updated");
    }
  }, [pending]);

  useEffect(() => {
    if (!on) return;
    const id = window.setInterval(() => {
      if (document.hidden) return;
      if (document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]')) return;
      startTransition(() => {
        router.refresh();
      });
    }, INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [on, router]);

  function refreshNow() {
    manual.current = true;
    startTransition(() => {
      router.refresh();
    });
  }

  function toggle(next: boolean) {
    window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
    listeners.forEach((l) => l());
  }

  return (
    <div className="flex items-center gap-3 text-sm">
      <Button type="button" variant="outline" size="sm" onClick={refreshNow} disabled={pending} aria-busy={pending}>
        <RefreshCw className={pending ? "size-4 animate-spin motion-reduce:animate-none" : "size-4"} aria-hidden="true" />
        {pending ? "Refreshing..." : "Refresh"}
      </Button>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={on} onChange={(e) => toggle(e.target.checked)} className="size-4 accent-brand" />
        Auto-refresh (60s)
      </label>
      <span className="text-ink-soft" role="status" aria-live="polite" suppressHydrationWarning>
        {pending ? "Refreshing..." : `Last updated ${updated}`}
      </span>
    </div>
  );
}
