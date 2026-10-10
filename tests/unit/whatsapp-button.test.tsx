import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PageShell } from "@/components/public/PageShell";
import { WhatsAppButton } from "@/components/public/WhatsAppButton";
import { getDictionary } from "@/lib/i18n";

describe("WhatsAppButton", () => {
  const html = renderToStaticMarkup(
    <WhatsAppButton href="https://wa.me/97333334444" label="Chat with us on WhatsApp" className="fixed end-4" />,
  );
  it("renders the wa.me link, label and safe link attributes", () => {
    expect(html).toContain('href="https://wa.me/97333334444"');
    expect(html).toContain('aria-label="Chat with us on WhatsApp"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });
  it("uses the theme accent, not WhatsApp green or raw hex", () => {
    expect(html).toContain("bg-brand");
    expect(html).toContain("fixed end-4");
    expect(html).not.toContain("green");
    expect(html).not.toMatch(/#[0-9a-f]{3,6}/i);
    expect(html).toContain('aria-hidden="true"');
  });
});

describe("PageShell WhatsApp button", () => {
  const dict = getDictionary("ar");
  const render = (whatsappUrl?: string | null) =>
    renderToStaticMarkup(
      <PageShell locale="ar" dict={dict} whatsappUrl={whatsappUrl}>
        <p>content</p>
      </PageShell>,
    );
  it("renders no button without a URL, or with null", () => {
    for (const html of [render(), render(null)]) {
      expect(html).not.toContain("wa.me");
      expect(html).not.toContain("5.5rem");
    }
  });
  it("renders the button, the dictionary label and the safe-area padding when a URL is set", () => {
    const html = render("https://wa.me/97333334444");
    expect(html).toContain('href="https://wa.me/97333334444"');
    expect(html).toContain(`aria-label="${dict.common.whatsapp_label}"`);
    expect(html).toContain("pb-[calc(5.5rem+env(safe-area-inset-bottom))]");
    expect(html).toContain("fixed end-4");
  });
});
