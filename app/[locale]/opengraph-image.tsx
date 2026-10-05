import { ImageResponse } from "next/og";
import { BRAND_MARK_PATHS, BRAND_PLUM } from "@/lib/brand-mark";
import { ar } from "@/lib/i18n/dictionaries/ar";
import { en } from "@/lib/i18n/dictionaries/en";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = `${ar.common.appTitle} | ${en.common.appTitle}`;

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: BRAND_PLUM }}>
        <svg viewBox="0 0 24 24" width={280} height={280} fill="none" stroke="#fff" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
          {BRAND_MARK_PATHS.map((d) => (
            <path key={d} d={d} />
          ))}
        </svg>
      </div>
    ),
    size,
  );
}
