import { z } from "zod";
import { BLOOD_TYPES, STATUSES } from "@/lib/config";
import { normaliseDigits, toAsciiDigits } from "@/lib/cpr";

/* Isomorphic: no server imports. Issue messages are `errors.*` dictionary keys. */

const trimmed = (v: unknown) => (typeof v === "string" ? v.trim() : v);
const blankToUndefined = (v: unknown) => {
  const s = trimmed(v);
  return s === "" || s === null ? undefined : s;
};

/** Collapse whitespace runs and trim. */
export function cleanName(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function isRealDate(iso: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

function todayUtcIso(): string {
  // Bahrain is UTC+3, so use that offset for "not in the future".
  return new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);
}

const nameField = z
  .string({ error: "name_required" })
  .transform(cleanName)
  .pipe(z.string().min(1, { error: "name_required" }).max(150, { error: "name_required" }));

const cprField = z
  .string({ error: "cpr_invalid" })
  .transform(normaliseDigits)
  .pipe(z.string().regex(/^[0-9]{9}$/, { error: "cpr_invalid" }));

/** Digits only, with a pasted Bahrain country code (+973 or 00973) removed. */
function normalisePhone(s: string): string {
  const d = normaliseDigits(s).replace(/^\+/, "");
  if (/^00973[0-9]{8}$/.test(d)) return d.slice(5);
  if (/^973[0-9]{8}$/.test(d)) return d.slice(3);
  return d;
}

const phoneField = z
  .string({ error: "phone_invalid" })
  .transform(normalisePhone)
  .pipe(z.string().regex(/^[0-9]{8}$/, { error: "phone_invalid" }));

const optionalPhoneField = z.preprocess(blankToUndefined, phoneField.optional());

const dobString = z
  .string({ error: "dob_required" })
  .transform((s) => toAsciiDigits(s.trim()))
  .pipe(
    z.string().superRefine((s, ctx) => {
      if (s === "") {
        ctx.addIssue({ code: "custom", message: "dob_required" });
      } else if (!(isRealDate(s) && s >= "1900-01-01" && s <= todayUtcIso())) {
        ctx.addIssue({ code: "custom", message: "dob_invalid" });
      }
    }),
  );

const optionalDobField = z.preprocess(blankToUndefined, dobString.optional());

const emailField = z.preprocess(
  blankToUndefined,
  z.email({ error: "email_invalid" }).max(254, { error: "email_invalid" }).optional(),
);

const bloodTypeField = z.enum(BLOOD_TYPES, { error: "server" });

const slotIdField = z
  .number({ error: "slot_required" })
  .int({ error: "slot_required" })
  .min(1, { error: "slot_required" })
  .max(32767, { error: "slot_required" });

const answerField = z.boolean({ error: "answer_required" });

export const signupSchema = z.strictObject({
  slotId: slotIdField,
  fullName: nameField,
  cpr: cprField,
  dob: dobString,
  phone: phoneField,
  email: emailField,
  bloodType: bloodTypeField,
  recentDonation: answerField,
  onMedication: answerField,
  consent: z.literal(true, { error: "consent_required" }),
  token: z.string({ error: "turnstile" }).max(4096, { error: "turnstile" }),
});
export type SignupInput = z.infer<typeof signupSchema>;

/** Same schema without the Turnstile token, for client-side validation. */
export const signupClientSchema = signupSchema.omit({ token: true });

/** Walk-in mode (decided by the server): no time is chosen. A slotId sent by a page loaded before the start time is accepted and ignored. */
export const signupWalkInSchema = z.strictObject({ ...signupSchema.shape, slotId: z.unknown().optional() });
export const signupWalkInClientSchema = signupWalkInSchema.omit({ token: true });

/* ---------- Admin ---------- */

const triState = z.preprocess(
  (v) => (v === "yes" || v === true ? true : v === "no" || v === false ? false : null),
  z.boolean().nullable(),
);

const optionalSlotId = z.preprocess((v) => {
  if (v === "" || v === null || v === undefined) return null;
  if (typeof v === "string") return Number(v);
  return v;
}, slotIdField.nullable());

const notesField = z.preprocess(
  blankToUndefined,
  z.string().max(1000, { error: "server" }).optional(),
);

const donorFields = {
  fullName: nameField,
  cpr: cprField,
  phone: optionalPhoneField,
  email: emailField,
  dob: optionalDobField,
  bloodType: bloodTypeField.default("unknown"),
  slotId: optionalSlotId,
  recentDonation: triState,
  onMedication: triState,
  notes: notesField,
};

const checkbox = z.preprocess((v) => v === true || v === "on" || v === "true" || v === "1", z.boolean());

export const adminDonorSchema = z
  .object({
    mode: z.enum(["walk_in", "pre_registration"], { error: "server" }),
    ...donorFields,
    consent: z.preprocess(
      (v) => v === true || v === "on" || v === "true" || v === "1",
      z.literal(true, { error: "consent_required" }),
    ),
    checkInNow: checkbox.default(false),
  })
  .superRefine((v, ctx) => {
    if (v.mode === "pre_registration" && v.slotId === null) {
      ctx.addIssue({ code: "custom", path: ["slotId"], message: "slot_required" });
    }
  })
  .transform((v) => ({
    ...v,
    slotId: v.mode === "walk_in" ? null : v.slotId,
    checkInNow: v.mode === "walk_in" ? v.checkInNow : false,
  }));
export type AdminDonorInput = z.infer<typeof adminDonorSchema>;

export const editDonorSchema = z.object({
  id: z.uuid(),
  ...donorFields,
});
export type EditDonorInput = z.infer<typeof editDonorSchema>;

export const statusSchema = z.enum(STATUSES);
export const donorIdSchema = z.uuid();
export const slotIdSchema = z.number().int().min(1).max(32767);

export const setStatusSchema = z.object({ donorId: z.uuid(), status: statusSchema });

const timeField = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, { error: "Enter a time as HH:MM" });

export const eventSchema = z.object({
  name_ar: z.string().trim().min(1).max(200),
  name_en: z.string().trim().min(1).max(200),
  location_ar: z.string().trim().max(200),
  location_en: z.string().trim().max(200),
  event_date: z.iso.date(),
  event_start_time: timeField,
  public_registration_open: checkbox,
});

const QUEUE_START_MSG = "Queue start must be a whole number from 1 to 99999";
export const queueStartSchema = z.object({
  queue_start: z.preprocess(
    (v) => (typeof v === "string" && v.trim() !== "" ? Number(v) : v),
    z
      .number({ error: QUEUE_START_MSG })
      .int({ error: QUEUE_START_MSG })
      .min(1, { error: QUEUE_START_MSG })
      .max(99999, { error: QUEUE_START_MSG }),
  ),
});

const capacityField = z.preprocess(
  (v) => (typeof v === "string" ? Number(v) : v),
  z.number().int().min(1, { error: "Capacity must be 1 to 500" }).max(500, { error: "Capacity must be 1 to 500" }),
);

export const createSlotSchema = z.object({ time: timeField, capacity: capacityField });
export const updateSlotSchema = z.object({
  slotId: slotIdSchema,
  capacity: capacityField,
  active: z.boolean(),
});

export const passwordSchema = z
  .object({
    password: z.string().min(12, { error: "Password must be at least 12 characters" }).max(128),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { path: ["confirm"], error: "Passwords do not match" });

export const addAdminSchema = z
  .object({
    email: z
      .preprocess(trimmed, z.email({ error: "Enter a valid email address" }).max(254))
      .transform((s) => s.toLowerCase()),
    displayName: z
      .string()
      .transform(cleanName)
      .pipe(
        z
          .string()
          .min(1, { error: "Enter a display name" })
          .max(60, { error: "Display name must be 60 characters or fewer" }),
      ),
    password: z.string().min(12, { error: "Password must be at least 12 characters" }).max(128),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { path: ["confirm"], error: "Passwords do not match" });

export const loginSchema = z.object({
  email: z.string().trim().min(1).max(254),
  password: z.string().min(1).max(128),
});
