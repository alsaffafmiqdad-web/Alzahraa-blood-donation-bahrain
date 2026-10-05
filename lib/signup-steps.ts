/* Isomorphic and framework-free: the step model of the public signup form. */

export const STEP_IDS = ["slot", "name", "identity", "contact", "bloodType", "photo", "screening", "review"] as const;
export type StepId = (typeof STEP_IDS)[number];
export type FieldKey =
  | "slotId"
  | "fullName"
  | "cpr"
  | "dob"
  | "phone"
  | "email"
  | "bloodType"
  | "cprImage"
  | "recentDonation"
  | "onMedication"
  | "consent";

export const STEP_FIELDS: Record<StepId, readonly FieldKey[]> = {
  slot: ["slotId"],
  name: ["fullName"],
  identity: ["cpr", "dob"],
  contact: ["phone", "email"],
  bloodType: ["bloodType"],
  photo: ["cprImage"],
  screening: ["recentDonation", "onMedication"],
  review: ["consent"],
};

const ORDER: StepId[] = [...STEP_IDS];

/** Slot mode: 8 steps. Walk-in mode: 7 (no "slot"). */
export function signupSteps(walkIn: boolean): StepId[] {
  return walkIn ? ORDER.filter((s) => s !== "slot") : [...ORDER];
}

/** The step that owns a field; null for unknown keys or "slotId" in walk-in mode. */
export function stepOfField(field: string, walkIn: boolean): StepId | null {
  for (const step of signupSteps(walkIn)) {
    if ((STEP_FIELDS[step] as readonly string[]).includes(field)) return step;
  }
  return null;
}

/** Errors for the given step's fields only. */
export function errorsForStep(errors: Record<string, string>, step: StepId): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of STEP_FIELDS[step]) if (key in errors) out[key] = errors[key] ?? "";
  return out;
}

/** Owner decisions B and W4: the photo is required only in slot mode. */
export function photoRequired(walkIn: boolean): boolean {
  return !walkIn;
}

/** Horizontal start offset in px for an entering step: forward enters from the inline end, back from the inline start. */
export function stepShift(direction: "forward" | "back", dir: "rtl" | "ltr"): 24 | -24 {
  const forward = direction === "forward";
  return (dir === "ltr") === forward ? 24 : -24;
}
