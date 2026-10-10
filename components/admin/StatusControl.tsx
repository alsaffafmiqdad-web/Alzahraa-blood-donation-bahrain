"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { checkInDonor, setDonorStatus } from "@/app/admin/actions";
import { checkInNotice, showCheckInNotice } from "@/lib/check-in-notice";
import { STATUSES } from "@/lib/config";
import type { Status } from "@/lib/donor-filters";
import type { StatusLabels } from "@/lib/status-labels";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export function StatusControl({
  donorId,
  name,
  status,
  labels,
}: {
  donorId: string;
  name: string;
  status: Status;
  labels: StatusLabels;
}) {
  const [value, setValue] = useState<Status>(status);
  const [confirm, setConfirm] = useState(false);
  const [pending, startTransition] = useTransition();

  // Keep the select in step with fresh server data after a refresh.
  const [seen, setSeen] = useState(status);
  if (seen !== status) {
    setSeen(status);
    setValue(status);
  }

  function apply(next: Status) {
    const previous = value;
    setValue(next);
    startTransition(async () => {
      if (next === "waiting") {
        const res = await checkInDonor(donorId);
        const notice = checkInNotice(name, res, labels);
        // Keep the select in step with the server: only a real check-in (or already waiting) shows the waiting status.
        setValue(res.ok && notice.kind !== "error" ? res.status : previous);
        showCheckInNotice(toast, notice);
        return;
      }
      const res = await setDonorStatus({ donorId, status: next });
      if (res.ok) toast.success(`${name} marked as ${labels[next]}`);
      else {
        setValue(previous);
        toast.error(res.error);
      }
    });
  }

  function onChange(next: Status) {
    if (next === value) return;
    if (next === "donated") {
      setConfirm(true);
      return;
    }
    apply(next);
  }

  return (
    <>
      <select
        aria-label={`Status for ${name}`}
        className="rounded-md border border-line bg-white px-2 py-1 text-sm disabled:opacity-60"
        value={value}
        disabled={pending}
        onChange={(e) => onChange(e.target.value as Status)}
      >
        {STATUSES.map((s) => (
          <option key={s} value={s}>
            {labels[s]}
          </option>
        ))}
      </select>
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Mark {name} as {labels.donated}?</AlertDialogTitle>
            <AlertDialogDescription>This confirms blood was actually collected.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirm(false);
                apply("donated");
              }}
            >
              Mark as {labels.donated}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
