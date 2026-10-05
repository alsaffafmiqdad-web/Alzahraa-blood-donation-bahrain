"use client";

import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createSlot, deleteSlot, updateSlot } from "@/app/admin/actions";
import { initialFormState } from "@/app/admin/action-types";
import { formatSlot } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export type SlotRow = {
  id: number;
  startsAt: string;
  capacity: number;
  active: boolean;
  booked: number;
  checkedIn: number;
  donated: number;
};

function Row({ slot }: { slot: SlotRow }) {
  const router = useRouter();
  const [capacity, setCapacity] = useState(String(slot.capacity));
  const [active, setActive] = useState(slot.active);
  const [pending, start] = useTransition();
  const dirty = Number(capacity) !== slot.capacity || active !== slot.active;
  const remaining = Math.max(0, slot.capacity - slot.booked);

  return (
    <TableRow>
      <TableCell className="font-medium">{formatSlot(slot.startsAt, "en")}</TableCell>
      <TableCell>
        <input
          type="number"
          min={1}
          max={500}
          value={capacity}
          onChange={(e) => setCapacity(e.target.value)}
          aria-label={`Capacity for ${formatSlot(slot.startsAt, "en")}`}
          className="w-20 rounded-md border border-line bg-white px-2 py-1 text-sm"
        />
      </TableCell>
      <TableCell>
        <input
          type="checkbox"
          checked={active}
          onChange={(e) => setActive(e.target.checked)}
          aria-label={`Active for ${formatSlot(slot.startsAt, "en")}`}
          className="size-4 accent-brand"
        />
      </TableCell>
      <TableCell>{slot.booked}</TableCell>
      <TableCell>{slot.checkedIn}</TableCell>
      <TableCell>{slot.donated}</TableCell>
      <TableCell>{remaining}</TableCell>
      <TableCell className="space-x-2 whitespace-nowrap">
        <Button
          type="button"
          size="sm"
          disabled={!dirty || pending}
          onClick={() =>
            start(async () => {
              const res = await updateSlot({ slotId: slot.id, capacity: Number(capacity), active });
              if (res.ok) {
                toast.success("Slot updated");
                router.refresh();
              } else toast.error(res.error);
            })
          }
        >
          Save
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pending || slot.booked > 0}
          title={slot.booked > 0 ? "Slot has bookings" : "Delete slot"}
          onClick={() =>
            start(async () => {
              const res = await deleteSlot(slot.id);
              if (res.ok) {
                toast.success("Slot deleted");
                router.refresh();
              } else toast.error(res.error);
            })
          }
        >
          Delete
        </Button>
      </TableCell>
    </TableRow>
  );
}

export function SlotsManager({ slots }: { slots: SlotRow[] }) {
  const [state, action, pending] = useActionState(createSlot, initialFormState);
  return (
    <div className="space-y-6">
      <div className="overflow-x-auto rounded-lg border border-line bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Time</TableHead>
              <TableHead>Capacity</TableHead>
              <TableHead>Active</TableHead>
              <TableHead>Booked</TableHead>
              <TableHead>Checked in</TableHead>
              <TableHead>Donated</TableHead>
              <TableHead>Remaining</TableHead>
              <TableHead>
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {slots.map((s) => (
              <Row key={`${s.id}-${s.capacity}-${s.active}`} slot={s} />
            ))}
          </TableBody>
        </Table>
      </div>

      <form action={action} className="flex flex-wrap items-end gap-3 rounded-lg border border-line bg-white p-4">
        <label className="flex flex-col gap-1 text-sm">
          Time
          <input name="time" type="time" required className="rounded-md border border-line px-2 py-1.5" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Capacity
          <input
            name="capacity"
            type="number"
            min={1}
            max={500}
            defaultValue={25}
            required
            className="w-24 rounded-md border border-line px-2 py-1.5"
          />
        </label>
        <Button type="submit" disabled={pending}>
          Add slot
        </Button>
        {state.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
        {state.ok && state.message && <p role="status" className="text-sm text-success">{state.message}</p>}
      </form>
    </div>
  );
}
