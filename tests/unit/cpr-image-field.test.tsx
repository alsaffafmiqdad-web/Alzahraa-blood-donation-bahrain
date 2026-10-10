import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CprImageField } from "@/components/public/CprImageField";
import { getDictionary } from "@/lib/i18n";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("CprImageField", () => {
  it("renders an enabled file input (never disabled while busy), no capture attribute", () => {
    const dict = getDictionary("en");
    const html = renderToStaticMarkup(
      <CprImageField dict={dict} value={null} onChange={() => {}} onBusyChange={() => {}} />,
    );
    const input = html.match(/<input[^>]*>/)?.[0] ?? "";
    expect(input).toContain('id="f-cprImage"');
    expect(input).toContain('type="file"');
    expect(input).toContain('accept="image/*"');
    expect(input).not.toContain("capture");
    expect(input).not.toContain("disabled");
    expect(input).toContain('aria-busy="false"');
    expect(html).not.toContain(dict.join.cpr_image_processing);
  });
  it("describes the input by the hint, and reports required by default", () => {
    const html = renderToStaticMarkup(
      <CprImageField dict={getDictionary("en")} value={null} onChange={() => {}} onBusyChange={() => {}} />,
    );
    const input = html.match(/<input[^>]*>/)?.[0] ?? "";
    expect(input).toContain("f-cprImage-hint");
    expect(input).toContain('aria-required="true"');
    expect(html).toContain('id="f-cprImage-hint"');
  });
  it("required={false} drops aria-required", () => {
    const html = renderToStaticMarkup(
      <CprImageField dict={getDictionary("en")} value={null} onChange={() => {}} onBusyChange={() => {}} required={false} />,
    );
    const input = html.match(/<input[^>]*>/)?.[0] ?? "";
    expect(input).toContain('aria-required="false"');
  });
  it("asHeading wraps the label in the step heading", () => {
    const html = renderToStaticMarkup(
      <CprImageField dict={getDictionary("en")} value={null} onChange={() => {}} onBusyChange={() => {}} asHeading />,
    );
    expect(html).toContain("<h2");
    expect(html).toContain('id="step-photo-title"');
  });
  it("a hint prop replaces the default hint", () => {
    const dict = getDictionary("en");
    const html = renderToStaticMarkup(
      <CprImageField dict={dict} value={null} onChange={() => {}} onBusyChange={() => {}} hint="Custom hint" label="Custom label" />,
    );
    expect(html).toContain("Custom hint");
    expect(html).toContain("Custom label");
    expect(html).not.toContain(dict.join.cpr_image_hint);
  });
  it("the idle drop zone shows the id card icon, not a plain camera", () => {
    const html = renderToStaticMarkup(
      <CprImageField dict={getDictionary("en")} value={null} onChange={() => {}} onBusyChange={() => {}} />,
    );
    expect(html).toContain("lucide-id-card");
    expect(html).toContain("lucide-camera");
    expect(html).toContain("-bottom-1 -end-1");
  });
  it.each([
    ["en", "Upload your CPR card"],
    ["ar", "ارفع بطاقتك الشخصية"],
  ] as const)("the step heading reads %s: %s", (locale, text) => {
    const dict = getDictionary(locale);
    expect(dict.join.q_photo).toBe(text);
    expect(dict.join.q_photo_optional).toBe(locale === "en" ? `${text} (optional)` : `${text} (اختياري)`);
    const html = renderToStaticMarkup(
      <CprImageField dict={dict} value={null} onChange={() => {}} onBusyChange={() => {}} asHeading label={dict.join.q_photo} />,
    );
    expect(html).toContain(`<label for="f-cprImage">${text}</label>`);
  });
  it("renders a dashed drop area and a screen-reader-only input", () => {
    const html = renderToStaticMarkup(
      <CprImageField dict={getDictionary("en")} value={null} onChange={() => {}} onBusyChange={() => {}} />,
    );
    expect(html).toContain("border-dashed");
    expect(html.match(/<input[^>]*>/)?.[0]).toContain("sr-only");
    expect(html.match(/for="f-cprImage"/g)).toHaveLength(2);
    expect(html).not.toContain("disabled");
  });
});
