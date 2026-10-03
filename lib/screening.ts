import { AGE_MAX, AGE_MIN } from "@/lib/config";

// Owner decision: two screening questions only. Anything else is asked in person.
export type ScreeningAnswers = {
  recentDonation: boolean | null;
  onMedication: boolean | null;
};
export type FlagReason = "recent_donation" | "on_medication" | "age_out_of_range";

/** Full years on `onDate`, birthday-aware. Both are YYYY-MM-DD; no timezone maths. */
export function ageOn(dob: string, onDate: string): number {
  const [by, bm, bd] = dob.split("-").map(Number) as [number, number, number];
  const [ey, em, ed] = onDate.split("-").map(Number) as [number, number, number];
  let age = ey - by;
  if (em < bm || (em === bm && ed < bd)) age -= 1;
  return age;
}

export function computeFlags(
  a: ScreeningAnswers,
  dob: string | null,
  eventDate: string,
): { flagged: boolean; reasons: FlagReason[] } {
  const reasons: FlagReason[] = [];
  if (a.recentDonation === true) reasons.push("recent_donation");
  if (a.onMedication === true) reasons.push("on_medication");
  if (dob) {
    const age = ageOn(dob, eventDate);
    if (age < AGE_MIN || age > AGE_MAX) reasons.push("age_out_of_range");
  }
  return { flagged: reasons.length > 0, reasons };
}
