import localFont from "next/font/local";

/** Body text, labels, inputs, buttons. */
export const thmanyahSans = localFont({
  src: [
    { path: "../assets/fonts/thmanyahsans/woff2/thmanyahsans-Regular.woff2", weight: "400", style: "normal" },
    { path: "../assets/fonts/thmanyahsans/woff2/thmanyahsans-Medium.woff2", weight: "500", style: "normal" },
    { path: "../assets/fonts/thmanyahsans/woff2/thmanyahsans-Bold.woff2", weight: "700", style: "normal" },
  ],
  display: "swap",
  variable: "--font-thmanyah-sans",
});

/** Headings. */
export const thmanyahDisplay = localFont({
  src: [
    {
      path: "../assets/fonts/thmanyahserifdisplay/woff2/thmanyahserifdisplay-Regular.woff2",
      weight: "400",
      style: "normal",
    },
    {
      path: "../assets/fonts/thmanyahserifdisplay/woff2/thmanyahserifdisplay-Medium.woff2",
      weight: "500",
      style: "normal",
    },
    {
      path: "../assets/fonts/thmanyahserifdisplay/woff2/thmanyahserifdisplay-Bold.woff2",
      weight: "700",
      style: "normal",
    },
  ],
  display: "swap",
  variable: "--font-thmanyah-display",
});
