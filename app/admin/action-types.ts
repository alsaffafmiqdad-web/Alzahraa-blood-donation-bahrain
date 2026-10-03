import type { Status } from "@/lib/donor-filters";

export type FormState = {
  ok: boolean;
  error?: string;
  /** Field-level messages keyed by field name. */
  fieldErrors?: Record<string, string>;
  existing?: { id: string; name: string };
  message?: string;
};

export const initialFormState: FormState = { ok: false };

export type CheckInResult =
  | { ok: true; queueNumber: number | null; alreadyCheckedIn: boolean; status: Status }
  | { ok: false; error: string };

export type SimpleResult = { ok: true } | { ok: false; error: string };
