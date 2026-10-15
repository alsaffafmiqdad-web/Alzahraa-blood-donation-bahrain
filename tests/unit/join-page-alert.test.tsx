import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  reportAlert: vi.fn(),
  getEvent: vi.fn(),
  getSlotAvailability: vi.fn(),
  getSiteSettings: vi.fn(),
}));

vi.mock("next/navigation", () => ({ notFound: () => {
  throw new Error("notFound");
} }));
vi.mock("@/lib/alert", () => ({ reportAlert: m.reportAlert }));
vi.mock("@/lib/db/public", () => ({
  getEvent: m.getEvent,
  getSlotAvailability: m.getSlotAvailability,
  getSiteSettings: m.getSiteSettings,
}));

import JoinPage from "@/app/[locale]/join/page";
import { formatAlert } from "@/lib/alert-format";

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  m.getSiteSettings.mockResolvedValue({ whatsappNumber: null });
  m.getSlotAvailability.mockResolvedValue([]);
});

describe("join page load failure", () => {
  it("reports the cause code, the route and the Supabase hint", async () => {
    const inner = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:54321"), {
      code: "ECONNREFUSED",
      syscall: "connect",
      address: "127.0.0.1",
      port: 54321,
    });
    m.getEvent.mockRejectedValue(new TypeError("fetch failed", { cause: inner }));
    await JoinPage({ params: Promise.resolve({ locale: "en" }) });
    expect(m.reportAlert).toHaveBeenCalledTimes(1);
    const alert = m.reportAlert.mock.calls[0]![0];
    expect(alert).toEqual({
      event: "join_load_failed",
      where: "/join",
      detail: "fetch failed (cause: ECONNREFUSED connect 127.0.0.1:54321)",
    });
    const { content } = formatAlert(alert, "local", 0);
    expect(content).toContain("where: /join");
    expect(content).toContain("ECONNREFUSED connect 127.0.0.1:54321");
    expect(content).toContain("hint: can't reach Supabase");
  });
});
