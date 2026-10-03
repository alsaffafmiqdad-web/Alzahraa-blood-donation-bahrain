import localFont from "next/font/local";

export const plex = localFont({
  src: [
    { path: "../assets/fonts/IBMPlexSansArabic-Regular.ttf", weight: "400", style: "normal" },
    { path: "../assets/fonts/IBMPlexSansArabic-Bold.ttf", weight: "700", style: "normal" },
  ],
  display: "swap",
  variable: "--font-plex",
});
