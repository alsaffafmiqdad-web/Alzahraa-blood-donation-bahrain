"use client";

import Link from "next/link";
import { useTransition } from "react";
import { toast } from "sonner";
import { checkInDonor } from "@/app/admin/actions";
import { checkInNotice, showCheckInNotice } from "@/lib/check-in-notice";
import type { DonorListRow } from "@/lib/donor-filters";
import { formatSlot } from "@/lib/format";
import { en } from "@/lib/i18n/dictionaries/en";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusControl } from "@/components/admin/StatusControl";

const SOURCE_LABEL = { self_signup: "Pre-reg", walk_in: "Walk-in", admin_added: "Staff added" } as const;

function flagText(reasons: string[]): string {
  const labels = en.flags as Record<string, string>;
  return reasons.map((r) => labels[r] ?? r).join("; ");
}

function CheckInButton({ row }: { row: DonorListRow }) {
  const [pending, start] = useTransition();
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await checkInDonor(row.id);
          showCheckInNotice(toast, checkInNotice(row.fullName, res));
        })
      }
    >
      Check in
    </Button>
  );
}

export function DonorTable({ rows, totalCount }: { rows: DonorListRow[]; totalCount: number }) {
  if (rows.length === 0) {
    return (
      <p className="rounded-lg border border-line bg-white p-6 text-center text-ink-soft">
        {totalCount === 0 ? "No donors registered yet." : "No donors match the current search or filter."}
      </p>
    );
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-white">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>#</TableHead>
            <TableHead>Name</TableHead>
            <TableHead>CPR</TableHead>
            <TableHead>Source</TableHead>
            <TableHead>Slot</TableHead>
            <TableHead>Phone</TableHead>
            <TableHead>Queue</TableHead>
            <TableHead>Flag</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id}>
              <TableCell className="text-ink-soft">{r.seq}</TableCell>
              <TableCell className="font-medium">
                <Link href={`/admin/donors/${r.id}`} className="text-crimson hover:underline" dir="auto">
                  {r.fullName}
                </Link>
              </TableCell>
              <TableCell className="font-mono text-xs">{r.cprMasked}</TableCell>
              <TableCell>
                <span className="rounded-full bg-paper-2 px-2 py-0.5 text-xs">{SOURCE_LABEL[r.source]}</span>
              </TableCell>
              <TableCell>{r.slotTime ? formatSlot(r.slotTime, "en") : "-"}</TableCell>
              <TableCell>{r.phone ?? "-"}</TableCell>
              <TableCell>{r.queueNumber !== null ? `#${r.queueNumber}` : "-"}</TableCell>
              <TableCell>
                {r.flagged ? (
                  <span className="rounded-full bg-flag-bg px-2 py-0.5 text-xs text-flag-ink">
                    {flagText(r.flagReasons) || "Flagged"}
                  </span>
                ) : (
                  ""
                )}
              </TableCell>
              <TableCell className="text-sm">{r.email ? (r.emailSent ? "Sent" : "Pending") : "None"}</TableCell>
              <TableCell>
                <StatusControl donorId={r.id} name={r.fullName} status={r.status} />
              </TableCell>
              <TableCell>
                {(r.status === "registered" || r.status === "verified" || r.status === "no_show") && <CheckInButton row={r} />}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
