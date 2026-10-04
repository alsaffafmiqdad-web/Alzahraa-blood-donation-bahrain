import "server-only";
import { renderToBuffer } from "@react-pdf/renderer";
import { registerFonts } from "@/lib/pdf/fonts";
import { RegistrationFormPdf, type RegistrationFormData } from "@/lib/pdf/RegistrationForm";

/** The donor's PDF: the A4 Donor Registration Form. */
export async function renderDonorCard(data: RegistrationFormData): Promise<Buffer> {
  registerFonts();
  return renderToBuffer(RegistrationFormPdf({ data }));
}
