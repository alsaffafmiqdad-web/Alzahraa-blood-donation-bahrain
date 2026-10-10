"use client";

import { useActionState } from "react";
import { updateTheme } from "@/app/admin/actions";
import { initialFormState } from "@/app/admin/action-types";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

export function ThemeForm({ accent, background }: { accent: string; background: string }) {
  const [state, action, pending] = useActionState(updateTheme, initialFormState);
  const fe = state.fieldErrors ?? {};
  const colour = "h-10 w-20 cursor-pointer rounded-md border border-line bg-white p-1";
  return (
    <form action={action} className="max-w-sm space-y-4">
      <div className="space-y-1">
        <Label htmlFor="theme_accent">Accent colour</Label>
        <input id="theme_accent" name="theme_accent" type="color" defaultValue={accent} className={colour} aria-describedby="theme-hint" />
        {fe.theme_accent && <p className="text-sm text-danger">{fe.theme_accent}</p>}
      </div>
      <div className="space-y-1">
        <Label htmlFor="theme_background">Page background</Label>
        <input
          id="theme_background"
          name="theme_background"
          type="color"
          defaultValue={background}
          className={colour}
          aria-describedby="theme-hint"
        />
        {fe.theme_background && <p className="text-sm text-danger">{fe.theme_background}</p>}
      </div>
      <p id="theme-hint" className="text-sm text-ink-soft">
        Defaults: accent #093f4c, background #fbf7f2. The accent is used for buttons with white text, so it must be dark enough.
      </p>
      {state.error && !state.fieldErrors && <p role="alert" className="text-sm text-danger">{state.error}</p>}
      {state.ok && state.message && <p role="status" className="text-sm text-success">{state.message}</p>}
      <Button type="submit" disabled={pending}>
        {pending ? "Saving..." : "Save colours"}
      </Button>
    </form>
  );
}
