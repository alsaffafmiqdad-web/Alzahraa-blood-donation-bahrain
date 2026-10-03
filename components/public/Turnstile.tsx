"use client";

import { useCallback, useEffect, useImperativeHandle, useRef, type Ref } from "react";
import Script from "next/script";
import { publicEnv } from "@/lib/public-env";

export type TurnstileHandle = { reset: () => void };

type Props = {
  locale: string;
  onToken: (token: string) => void;
  warning: string;
  ref?: Ref<TurnstileHandle>;
};

export function Turnstile({ locale, onToken, warning, ref }: Props) {
  const siteKey = publicEnv.turnstileSiteKey;
  const elRef = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | undefined>(undefined);

  const render = useCallback(() => {
    if (!siteKey || !elRef.current || !window.turnstile || widgetId.current !== undefined) return;
    widgetId.current = window.turnstile.render(elRef.current, {
      sitekey: siteKey,
      language: locale,
      callback: (token) => onToken(token),
      "expired-callback": () => onToken(""),
      "error-callback": () => onToken(""),
    });
  }, [siteKey, locale, onToken]);

  useImperativeHandle(ref, () => ({
    reset() {
      onToken("");
      if (window.turnstile && widgetId.current !== undefined) window.turnstile.reset(widgetId.current);
    },
  }));

  useEffect(() => {
    render();
    return () => {
      if (window.turnstile && widgetId.current !== undefined) {
        window.turnstile.remove(widgetId.current);
        widgetId.current = undefined;
      }
    };
  }, [render]);

  if (!siteKey) {
    return (
      <p role="alert" className="rounded-md bg-flag-bg px-3 py-2 text-sm text-flag-ink">
        {warning}
      </p>
    );
  }

  return (
    <>
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        strategy="afterInteractive"
        onReady={render}
      />
      <div ref={elRef} />
    </>
  );
}
