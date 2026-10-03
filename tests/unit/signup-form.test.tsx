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

const slots = [
  { id: 1, startsAt: "08:30:00", capacity: 25, booked: 3 },
  { id: 2, startsAt: "09:00:00", capacity: 25, booked: 25 },
];

describe("SignupForm", () => {
  it("renders the Arabic form with two screening questions and a disabled full slot", () => {
    const html = renderToString(
      <SignupForm locale="ar" dict={getDictionary("ar")} slots={slots} eventDate="2026-10-16" slotHint="hint" />,
    );
    expect(html).toContain("تبرعت بالدم خلال 3 أشهر؟");
    expect(html).toContain("تتناول مضادات حيوية أو أدوية؟");
    expect(html.match(/type="radio"/g)).toHaveLength(4);
    expect(html).toContain("(مكتمل)");
    expect(html).toMatch(/<option value="2" disabled/);
    expect(html).not.toContain('max="2008-10-16"'); // under-18 is flagged, never blocked
    expect(html).toContain('maxLength="16"'); // phone: room for a pasted +973
    expect(html).toContain('maxLength="9"');
    expect(html).not.toMatch(/\b(ml|mr|pl|pr)-\d/);
  });
});
