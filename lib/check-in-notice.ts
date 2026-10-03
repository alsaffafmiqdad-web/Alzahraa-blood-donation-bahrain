import type { CheckInResult } from "@/app/admin/action-types";
import { STATUS_LABELS } from "@/lib/status-labels";

export type CheckInNotice = { kind: "success" | "info" | "error"; text: string };

/**
 * Turns a check-in result into the toast the admin sees. Never prints "queue #null": a queue number
 * appears only when the server really returned one, and a refused check-in shows the real reason.
 */
export function checkInNotice(name: string, res: CheckInResult): CheckInNotice {
  if (!res.ok) return { kind: "error", text: res.error };
  const queue = res.queueNumber === null ? "" : `, queue #${res.queueNumber}`;
  if (!res.alreadyCheckedIn) return { kind: "success", text: `${name} checked in${queue}` };
  if (res.status === "waiting") return { kind: "info", text: `${name} is already checked in${queue}` };
  if (res.status === "deferred") {
    return {
      kind: "error",
      text: `${name} is Deferred and cannot be checked in. Change the status first if they are cleared to donate.`,
    };
  }
  return { kind: "error", text: `${name} is already ${STATUS_LABELS[res.status]}, so check-in does not apply.` };
}

export function showCheckInNotice(
  toast: { success(m: string): unknown; info(m: string): unknown; error(m: string): unknown },
  notice: CheckInNotice,
): void {
  toast[notice.kind](notice.text);
}
