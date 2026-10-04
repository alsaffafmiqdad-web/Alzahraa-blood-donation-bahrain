import "server-only";
import path from "node:path";
import { Font } from "@react-pdf/renderer";

let registered = false;

/**
 * Registers Thmanyah Sans (body, Arabic and Latin) and Thmanyah Serif Display (titles) from the OTF files
 * (react-pdf cannot read WOFF2). Idempotent.
 */
export function registerFonts(): void {
  if (registered) return;
  const dir = path.join(process.cwd(), "assets/fonts");
  Font.register({
    family: "ThmanyahSans",
    fonts: [
      { src: path.join(dir, "thmanyahsans/otf/thmanyahsans-Regular.otf") },
      { src: path.join(dir, "thmanyahsans/otf/thmanyahsans-Bold.otf"), fontWeight: 700 },
    ],
  });
  Font.register({
    family: "ThmanyahDisplay",
    fonts: [
      { src: path.join(dir, "thmanyahserifdisplay/otf/thmanyahserifdisplay-Regular.otf") },
      { src: path.join(dir, "thmanyahserifdisplay/otf/thmanyahserifdisplay-Bold.otf"), fontWeight: 700 },
    ],
  });
  // Keep Arabic words whole.
  Font.registerHyphenationCallback((word) => [word]);
  registered = true;
}
