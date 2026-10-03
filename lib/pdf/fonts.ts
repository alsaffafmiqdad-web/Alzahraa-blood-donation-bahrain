import "server-only";
import path from "node:path";
import { Font } from "@react-pdf/renderer";

let registered = false;

/** Registers IBM Plex Sans Arabic (Arabic and Latin glyphs). Idempotent. */
export function registerFonts(): void {
  if (registered) return;
  const dir = path.join(process.cwd(), "assets/fonts");
  Font.register({
    family: "PlexArabic",
    fonts: [
      { src: path.join(dir, "IBMPlexSansArabic-Regular.ttf") },
      { src: path.join(dir, "IBMPlexSansArabic-Bold.ttf"), fontWeight: 700 },
    ],
  });
  // Keep Arabic words whole.
  Font.registerHyphenationCallback((word) => [word]);
  registered = true;
}
