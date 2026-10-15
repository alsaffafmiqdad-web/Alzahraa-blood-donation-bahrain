import "server-only";
import path from "node:path";
import { Document, Image, Page, StyleSheet } from "@react-pdf/renderer";
import { View } from "@react-pdf/renderer";

import { AutoText, hardBreakLongWords } from "@/lib/pdf/RegistrationForm";

/**
 * The donation certificate: the A4 landscape artwork with the donor's full name to the left of the
 * red yarn ball. All other text is baked into the background image.
 */
export const CERT_PAGE = { width: 841.89, height: 595.28 }; // A4 landscape, pt

const BOX = { left: 40, width: 394, top: 246, height: 100 };

/** Font size by name length (in characters), so long names still fit the box. */
export function certificateNameSize(name: string): number {
  const n = Array.from(name.trim()).length;
  if (n <= 22) return 30;
  if (n <= 32) return 24;
  if (n <= 45) return 20;
  return 16;
}

const styles = StyleSheet.create({
  page: { position: "relative", padding: 0 },
  bg: { position: "absolute", top: 0, left: 0, width: CERT_PAGE.width, height: CERT_PAGE.height },
  box: {
    position: "absolute",
    left: BOX.left,
    width: BOX.width,
    top: BOX.top,
    height: BOX.height,
    justifyContent: "center",
    alignItems: "flex-end",
  },
});

export function CertificatePdf({ name }: { name: string }) {
  const clean = name.trim();
  const size = certificateNameSize(clean);
  return (
    <Document title="Donation Certificate">
      <Page size="A4" orientation="landscape" style={styles.page}>
        {/* react-pdf Image, not an HTML img: there is no alt attribute in a PDF page. */}
        {/* eslint-disable-next-line jsx-a11y/alt-text */}
        <Image fixed src={path.join(process.cwd(), "assets/certificate/certificate-background.jpg")} style={styles.bg} />
        <View style={styles.box}>
          <AutoText
            text={hardBreakLongWords(clean, BOX.width, size)}
            style={{ fontFamily: "ThmanyahSans", fontWeight: 700, color: "#7A1622", fontSize: size, textAlign: "right" }}
            rowStyle={{ alignSelf: "flex-end" }}
          />
        </View>
      </Page>
    </Document>
  );
}
