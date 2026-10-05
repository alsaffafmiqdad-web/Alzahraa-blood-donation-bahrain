/* Isomorphic and pure: the signup form draft kept in sessionStorage (this tab only). Never stores consent or the Turnstile token. */
import { z } from "zod";
import { BLOOD_TYPES } from "@/lib/config";
import { STEP_IDS, type StepId } from "@/lib/signup-steps";

export const DRAFT_KEY = "signup-draft-v1";
export const DRAFT_PHOTO_KEY = "signup-draft-photo-v1";
export const DRAFT_TTL_MS = 2 * 60 * 60 * 1000;
/** Photos larger than this are not stored (base64 is about 4/3 larger; keeps under Safari's ~5 MB sessionStorage quota). */
export const DRAFT_PHOTO_MAX_BYTES = 1_500_000;

const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
type PhotoType = (typeof PHOTO_TYPES)[number];

export type DraftValues = {
  slotId: string;
  fullName: string;
  cpr: string;
  dobDay: string;
  dobMonth: string;
  dobYear: string;
  phone: string;
  email: string;
  bloodType: string;
  recentDonation: "" | "yes" | "no";
  onMedication: "" | "yes" | "no";
};

export type Draft = {
  v: 1;
  savedAt: number;
  eventDate: string;
  step: StepId;
  values: DraftValues;
  submissionId: string | null;
  hadPhoto: boolean;
};

export type DraftPhoto = { v: 1; savedAt: number; eventDate: string; type: PhotoType; b64: string };

const tri = z.enum(["", "yes", "no"]);
const draftSchema = z.strictObject({
  v: z.literal(1),
  savedAt: z.number().finite(),
  eventDate: z.string().max(10),
  step: z.enum(STEP_IDS),
  values: z.strictObject({
    slotId: z.string().max(6),
    fullName: z.string().max(150),
    cpr: z.string().max(13),
    dobDay: z.string().max(2),
    dobMonth: z.string().max(2),
    dobYear: z.string().max(4),
    phone: z.string().max(16),
    email: z.string().max(254),
    bloodType: z.enum(["", ...BLOOD_TYPES]),
    recentDonation: tri,
    onMedication: tri,
  }),
  submissionId: z.uuid().nullable(),
  hadPhoto: z.boolean(),
});

const photoSchema = z.strictObject({
  v: z.literal(1),
  savedAt: z.number().finite(),
  eventDate: z.string().max(10),
  type: z.enum(PHOTO_TYPES),
  b64: z.string().max(Math.ceil((DRAFT_PHOTO_MAX_BYTES * 4) / 3) + 4),
});

function parseJson(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function stale(savedAt: number, now: number | undefined): boolean {
  return now !== undefined && now - savedAt > DRAFT_TTL_MS;
}

export function serializeDraft(d: Omit<Draft, "v" | "savedAt">, now: number): string {
  const draft: Draft = {
    v: 1,
    savedAt: now,
    eventDate: d.eventDate,
    step: d.step,
    values: {
      slotId: d.values.slotId,
      fullName: d.values.fullName,
      cpr: d.values.cpr,
      dobDay: d.values.dobDay,
      dobMonth: d.values.dobMonth,
      dobYear: d.values.dobYear,
      phone: d.values.phone,
      email: d.values.email,
      bloodType: d.values.bloodType,
      recentDonation: d.values.recentDonation,
      onMedication: d.values.onMedication,
    },
    submissionId: d.submissionId,
    hadPhoto: d.hadPhoto,
  };
  return JSON.stringify(draft);
}

export function parseDraft(
  raw: string | null,
  opts: { eventDate: string; walkIn: boolean; now?: number },
): Draft | null {
  const parsed = draftSchema.safeParse(parseJson(raw));
  if (!parsed.success) return null;
  const d = parsed.data as Draft;
  if (d.eventDate !== opts.eventDate || stale(d.savedAt, opts.now)) return null;
  if (opts.walkIn) {
    return { ...d, values: { ...d.values, slotId: "" }, step: d.step === "slot" ? "name" : d.step };
  }
  return d;
}

export function isEmptyDraft(values: DraftValues): boolean {
  return (Object.values(values) as string[]).every((v) => v === "");
}

export function bytesToBase64(b: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < b.length; i += 0x8000) bin += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function base64ToBytes(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function serializeDraftPhoto(bytes: Uint8Array, type: DraftPhoto["type"], eventDate: string, now: number): string | null {
  if (bytes.length > DRAFT_PHOTO_MAX_BYTES) return null;
  if (!(PHOTO_TYPES as readonly string[]).includes(type)) return null;
  const photo: DraftPhoto = { v: 1, savedAt: now, eventDate, type, b64: bytesToBase64(bytes) };
  return JSON.stringify(photo);
}

export function parseDraftPhoto(
  raw: string | null,
  opts: { eventDate: string; now?: number },
): { bytes: Uint8Array; type: DraftPhoto["type"] } | null {
  const parsed = photoSchema.safeParse(parseJson(raw));
  if (!parsed.success) return null;
  const p = parsed.data;
  if (p.eventDate !== opts.eventDate || stale(p.savedAt, opts.now)) return null;
  try {
    return { bytes: base64ToBytes(p.b64), type: p.type };
  } catch {
    return null;
  }
}
