import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/ar/join",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next/script", () => ({ default: () => null }));

import { SignupForm } from "@/components/public/SignupForm";
import { getDictionary } from "@/lib/i18n";
import { whatsAppUrl } from "@/lib/whatsapp";

const render = (whatsappUrl: string | null) =>
  renderToString(
    <SignupForm
      locale="ar"
      dict={getDictionary("ar")}
      slots={[{ id: 1, startsAt: "08:30:00", capacity: 25, booked: 3 }]}
      eventDate="2026-10-16"
      slotHint="hint"
      walkIn={false}
      event={{ name: "Drive Name", dateText: "16 October 2026", timeText: "8:30 AM", location: "Hall" }}
      whatsappUrl={whatsappUrl}
    />,
  );

describe("SignupForm WhatsApp button", () => {
  it("is not rendered when the number is empty", () => {
    const html = render(whatsAppUrl(""));
    expect(html).not.toContain("wa.me");
    expect(html).not.toContain("pb-24");
  });

  it("is rendered with the dictionary label and extra bottom padding when a number is set", () => {
    const html = render(whatsAppUrl("+973 3333 4444"));
    expect(html).toContain('href="https://wa.me/97333334444"');
    expect(html).toContain(getDictionary("ar").common.whatsapp_label);
    expect(html).toContain("pb-24");
  });
});
