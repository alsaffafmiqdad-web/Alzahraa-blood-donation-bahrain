import "server-only";
import type { DonorForEmail } from "@/lib/db/email";
import { orgInfo } from "@/lib/env";
import { formatDateShort, shortRef } from "@/lib/format";
import type { RegistrationFormData } from "@/lib/pdf/RegistrationForm";
import { renderDonorCard } from "@/lib/pdf/render";

/** What the confirmation email body shows. No CPR, phone or screening data. */
export type DonorCardData = {
  fullName: string;
  ref: string;
  bloodType: string /* 'unknown' or code */;
  slotTime: string | null /* 'HH:MM:SS' */;
  queueNumber: number | null;
  signupDate: string /* ISO */;
  event: { name_ar: string; name_en: string; location_ar: string; location_en: string; event_date: string };
  org: { name: string; email: string; phone: string };
};

/** The confirmation email body content for one donor. */
export function donorCardData(donor: DonorForEmail): DonorCardData {
  return {
    fullName: donor.fullName,
    ref: shortRef(donor.id),
    bloodType: donor.bloodType,
    slotTime: donor.slotTime,
    queueNumber: donor.queueNumber,
    signupDate: donor.createdAt,
    event: donor.event,
    org: orgInfo(),
  };
}

/**
 * Owner decision: the donor's PDF (download and email attachment) is exactly the admin's A4
 * Donor Registration Form, including the full CPR, flags and notes.
 */
export function registrationFormData(donor: DonorForEmail, now: Date = new Date()): RegistrationFormData {
  return {
    donor: {
      ref: shortRef(donor.id),
      fullName: donor.fullName,
      cpr: donor.cpr,
      dob: donor.dob,
      phone: donor.phone,
      email: donor.email,
      bloodType: donor.bloodType,
      slotTime: donor.slotTime,
      createdAt: donor.createdAt,
      source: donor.source,
      queueNumber: donor.queueNumber,
      flagged: donor.flagged,
      flagReasons: donor.flagReasons,
      notes: donor.notes,
    },
    event: donor.event,
    printedOn: formatDateShort(now.toISOString()),
  };
}

export async function donorCardPdf(donor: DonorForEmail): Promise<Buffer> {
  return renderDonorCard(registrationFormData(donor));
}
