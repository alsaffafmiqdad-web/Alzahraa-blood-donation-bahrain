"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { checkInDonor, deleteDonor, resendEmail, verifyDonor } from "@/app/admin/actions";
import { checkInNotice, showCheckInNotice } from "@/lib/check-in-notice";
import type { Status } from "@/lib/donor-filters";
import { Button } from "@/components/ui/button";
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
import { StatusControl } from "@/components/admin/StatusControl";

type Props = {
  donorId: string;
  name: string;
  status: Status;
  hasEmail: boolean;
  emailSent: boolean;
};

export function DonorActions({ donorId, name, status, hasEmail, emailSent }: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const canCheckIn = status === "registered" || status === "verified" || status === "no_show";
  const printUrl = `/admin/donors/${donorId}/print`;

  function checkIn(thenPrint: boolean) {
    start(async () => {
      const res = await checkInDonor(donorId);
      const notice = checkInNotice(name, res);
      if (thenPrint && notice.kind === "error") toast.error(`Check-in failed (${notice.text}). Printing anyway.`);
      else showCheckInNotice(toast, notice);
      if (thenPrint) window.open(printUrl, "_blank");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {status === "registered" && (
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const res = await verifyDonor(donorId);
              if (res.ok) toast.success(`${name} verified`);
              else toast.error(res.error);
            })
          }
        >
          Verify (CPR card checked)
        </Button>
      )}
      {canCheckIn && (
        <>
          <Button type="button" disabled={pending} onClick={() => checkIn(false)}>
            Check in
          </Button>
          <Button type="button" disabled={pending} onClick={() => checkIn(true)}>
            Check in &amp; print
          </Button>
        </>
      )}
      <Button asChild variant="outline">
        <Link href={printUrl} target="_blank">
          Print
        </Link>
      </Button>
      <StatusControl donorId={donorId} name={name} status={status} />
      <Button asChild variant="outline">
        <Link href={`/admin/donors/${donorId}/edit`}>Edit</Link>
      </Button>
      {hasEmail && (
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const res = await resendEmail(donorId);
              if (res.outcome === "sent") toast.success("Email sent");
              else if (res.outcome === "queued")
                toast.warning("Daily email limit reached; it will be retried by the daily job");
              else if (res.outcome === "none") toast.error("This donor has no email address");
              else toast.error("Email failed. See the error on this page.");
              router.refresh();
            })
          }
        >
          {emailSent ? "Send email again" : "Send email"}
        </Button>
      )}
      <Button type="button" variant="destructive" disabled={pending} onClick={() => setConfirmDelete(true)}>
        Delete
      </Button>
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this donor registration?</AlertDialogTitle>
            <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                start(async () => {
                  const res = await deleteDonor(donorId);
                  if (res.ok) {
                    toast.success("Donor deleted");
                    router.push("/admin");
                  } else toast.error(res.error);
                })
              }
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
