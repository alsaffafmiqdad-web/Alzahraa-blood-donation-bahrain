"use client";

import { useState, useSyncExternalStore } from "react";
import type { Dictionary } from "@/lib/i18n";

/** sessionStorage key for the short-lived card token issued by /api/signup (this tab only). */
export const CARD_TOKEN_KEY = "alz-donor-card";

type State = "idle" | "busy" | "error";

function readToken(): string | null {
  try {
    return sessionStorage.getItem(CARD_TOKEN_KEY);
  } catch {
    return null;
  }
}

// The token is written before navigating here and never changes while the page is open.
function subscribe(): () => void {
  return () => {};
}

/** "Download your donor card" on the success page. Hidden when this tab has no card token. */
export function CardDownload({ dict }: { dict: Dictionary["success"] }) {
  const token = useSyncExternalStore(subscribe, readToken, () => null);
  const [state, setState] = useState<State>("idle");

  if (!token) return null;

  async function download() {
    if (state === "busy" || !token) return;
    setState("busy");
    try {
      const res = await fetch("/api/card", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = "donor-card.pdf";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setState("idle");
    } catch {
      setState("error");
    }
  }

  return (
    <div className="rounded-xl border border-line bg-white p-5">
      <p className="mb-3">{dict.card_hint}</p>
      <button
        type="button"
        onClick={download}
        disabled={state === "busy"}
        className="inline-block rounded-lg bg-crimson px-5 py-3 font-bold text-white hover:bg-crimson-dark disabled:opacity-60"
      >
        {state === "busy" ? dict.card_downloading : dict.card_download}
      </button>
      {state === "error" && (
        <p role="alert" className="mt-2 text-sm text-crimson">
          {dict.card_error}
        </p>
      )}
    </div>
  );
}
