import "server-only";
import { renderToBuffer } from "@react-pdf/renderer";
import { DonorCard, type DonorCardData } from "@/lib/pdf/DonorCard";
import { registerFonts } from "@/lib/pdf/fonts";

export async function renderDonorCard(data: DonorCardData): Promise<Buffer> {
  registerFonts();
  return renderToBuffer(DonorCard({ data }));
}
