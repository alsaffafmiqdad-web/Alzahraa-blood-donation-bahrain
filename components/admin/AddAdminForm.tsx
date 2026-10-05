"use client";

import { useActionState, useEffect, useRef } from "react";
import { addAdmin } from "@/app/admin/actions";
import { initialFormState } from "@/app/admin/action-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function AddAdminForm() {
  const [state, action, pending] = useActionState(addAdmin, initialFormState);
  const formRef = useRef<HTMLFormElement>(null);
  const fe = state.fieldErrors ?? {};

  useEffect(() => {
    if (state.ok) formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={action} className="max-w-sm space-y-4">
      <div className="space-y-1">
        <Label htmlFor="admin-email">Email</Label>
        <Input id="admin-email" name="email" type="email" autoComplete="off" dir="ltr" required />
        {fe.email && <p className="text-sm text-danger">{fe.email}</p>}
      </div>
      <div className="space-y-1">
        <Label htmlFor="admin-displayName">Display name</Label>
        <Input id="admin-displayName" name="displayName" maxLength={60} autoComplete="off" required />
        {fe.displayName && <p className="text-sm text-danger">{fe.displayName}</p>}
      </div>
      <div className="space-y-1">
        <Label htmlFor="admin-password">Temporary password (at least 12 characters)</Label>
        <Input
          id="admin-password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={12}
          required
        />
        {fe.password && <p className="text-sm text-danger">{fe.password}</p>}
      </div>
      <div className="space-y-1">
        <Label htmlFor="admin-confirm">Confirm password</Label>
        <Input id="admin-confirm" name="confirm" type="password" autoComplete="new-password" required />
        {fe.confirm && <p className="text-sm text-danger">{fe.confirm}</p>}
      </div>
      {state.error && !state.fieldErrors && <p role="alert" className="text-sm text-danger">{state.error}</p>}
      {state.ok && state.message && <p role="status" className="text-sm text-success">{state.message}</p>}
      <Button type="submit" disabled={pending}>
        {pending ? "Adding..." : "Add admin"}
      </Button>
    </form>
  );
}
