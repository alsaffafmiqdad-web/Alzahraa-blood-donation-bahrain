"use client";

import { useActionState } from "react";
import { updateStatusLabels } from "@/app/admin/actions";
import { initialFormState } from "@/app/admin/action-types";
import { STATUSES } from "@/lib/config";
import { STATUS_LABEL_MAX, type StatusLabels } from "@/lib/status-labels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function StatusLabelsForm({ labels }: { labels: StatusLabels }) {
  const [state, action, pending] = useActionState(updateStatusLabels, initialFormState);
  const fe = state.fieldErrors ?? {};
  return (
    <form action={action} className="max-w-sm space-y-4">
      <p id="status-labels-hint" className="text-sm text-ink-soft">
        Rename how each status appears in the admin panel and the CSV. The seven statuses are fixed: they can be renamed but not added or removed.
      </p>
      {STATUSES.map((s) => (
        <div key={s} className="space-y-1">
          <Label htmlFor={`label_${s}`}>
            <code className="text-ink-soft">{s}</code>
          </Label>
          <Input
            id={`label_${s}`}
            name={`label_${s}`}
            defaultValue={labels[s]}
            maxLength={STATUS_LABEL_MAX}
            required
            aria-describedby="status-labels-hint"
          />
          {fe[`label_${s}`] && <p className="text-sm text-danger">{fe[`label_${s}`]}</p>}
        </div>
      ))}
      {state.error && !state.fieldErrors && <p role="alert" className="text-sm text-danger">{state.error}</p>}
      {state.ok && state.message && <p role="status" className="text-sm text-success">{state.message}</p>}
      <Button type="submit" disabled={pending}>
        {pending ? "Saving..." : "Save status names"}
      </Button>
    </form>
  );
}
