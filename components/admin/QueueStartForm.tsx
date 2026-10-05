"use client";

import { useActionState } from "react";
import { updateQueueStart } from "@/app/admin/actions";
import { initialFormState } from "@/app/admin/action-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function QueueStartForm({ queueStart, nextNumber }: { queueStart: number; nextNumber: number }) {
  const [state, action, pending] = useActionState(updateQueueStart, initialFormState);
  const fe = state.fieldErrors ?? {};
  return (
    <form action={action} className="max-w-sm space-y-4">
      <div className="space-y-1">
        <Label htmlFor="queue_start">First queue number</Label>
        <Input
          id="queue_start"
          name="queue_start"
          type="number"
          inputMode="numeric"
          min={1}
          max={99999}
          step={1}
          defaultValue={queueStart}
          required
          aria-describedby="queue_start-hint"
        />
        <p id="queue_start-hint" className="text-sm text-ink-soft">
          The next number issued is {nextNumber}. Raising this makes the next number jump to it. Lowering it below numbers already issued has no effect, so a number is never given out twice.
        </p>
        {fe.queue_start && <p className="text-sm text-danger">{fe.queue_start}</p>}
      </div>
      {state.error && !state.fieldErrors && <p role="alert" className="text-sm text-danger">{state.error}</p>}
      {state.ok && state.message && <p role="status" className="text-sm text-success">{state.message}</p>}
      <Button type="submit" disabled={pending}>
        {pending ? "Saving..." : "Save queue start"}
      </Button>
    </form>
  );
}
