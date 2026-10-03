import type { Status } from "@/lib/donor-filters";

export const STATUS_LABELS: Record<Status, string> = {
  registered: "Registered",
  verified: "Verified",
  waiting: "Waiting",
  screening: "Screening",
  donated: "Donated",
  deferred: "Deferred",
  no_show: "No show",
};
