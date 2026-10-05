"use client";

import { useActionState } from "react";
import { changePassword } from "@/app/admin/actions";
import { initialFormState } from "@/app/admin/action-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function PasswordForm() {
  const [state, action, pending] = useActionState(changePassword, initialFormState);
  const fe = state.fieldErrors ?? {};
  return (
    <form action={action} className="max-w-sm space-y-4">
      <div className="space-y-1">
        <Label htmlFor="password">New password (at least 12 characters)</Label>
        <Input id="password" name="password" type="password" autoComplete="new-password" minLength={12} required />
        {fe.password && <p className="text-sm text-danger">{fe.password}</p>}
      </div>
      <div className="space-y-1">
        <Label htmlFor="confirm">Confirm password</Label>
        <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required />
        {fe.confirm && <p className="text-sm text-danger">{fe.confirm}</p>}
      </div>
      {state.error && !state.fieldErrors && <p role="alert" className="text-sm text-danger">{state.error}</p>}
      {state.ok && state.message && <p role="status" className="text-sm text-success">{state.message}</p>}
      <Button type="submit" disabled={pending}>
        {pending ? "Saving..." : "Change password"}
      </Button>
    </form>
  );
}
