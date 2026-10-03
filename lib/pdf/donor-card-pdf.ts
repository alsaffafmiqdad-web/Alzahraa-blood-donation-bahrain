import "server-only";
import type { DonorForEmail } from "@/lib/db/email";
import { orgInfo } from "@/lib/env";
import { shortRef } from "@/lib/format";
import type { DonorCardData } from "@/lib/pdf/DonorCard";
import { renderDonorCard } from "@/lib/pdf/render";

/** The donor card content for one donor. Shared by the confirmation email and the success-page download. */
export function donorCardData(donor: DonorForEmail): DonorCardData {
  return {
    fullName: donor.fullName,
    ref: shortRef(donor.id),
    bloodType: donor.bloodType,
    slotTime: donor.slotTime,
    signupDate: donor.createdAt,
    event: donor.event,
    org: orgInfo(),
  };
}

export async function donorCardPdf(donor: DonorForEmail): Promise<Buffer> {
  return renderDonorCard(donorCardData(donor));
}
