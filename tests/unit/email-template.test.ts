import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildConfirmationEmail, escapeHtml } from "@/lib/email/templates";
import type { DonorCardData } from "@/lib/pdf/donor-card-pdf";

const base: DonorCardData & { emailTo: string } = {
  fullName: "Ali Hasan",
  ref: "A1B2C3D4",
  bloodType: "O+",
  slotTime: "09:30:00",
  queueNumber: null,
  signupDate: "2026-10-03T10:00:00Z",
  event: {
    name_ar: "حملة عطاء الزهراء ال 9 للتبرع بالدم",
    name_en: "Alzahraa Ataa 9th Blood Donation Campaign",
    location_ar: "صالة فاطمة كانو، توبلي",
    location_en: "Fatima Kanoo Hall, Tubli",
    event_date: "2026-10-16",
  },
  org: { name: "Org", email: "info@example.org", phone: "+973 1700 0000" },
  emailTo: "ali@example.com",
};

describe("queue number line", () => {
  it("shows the queue number in both languages when the donor has one", () => {
    const { html, text } = buildConfirmationEmail({ ...base, queueNumber: 12 });
    for (const out of [html, text]) {
      expect(out).toContain("رقم الدور");
      expect(out).toContain("Queue number");
      expect(out).toContain("#12");
    }
  });
  it("shows neither label without a number", () => {
    const { html, text } = buildConfirmationEmail(base);
    for (const out of [html, text]) {
      expect(out).not.toContain("رقم الدور");
      expect(out).not.toContain("Queue number");
    }
  });
});

describe("buildConfirmationEmail", () => {
  it("has a bilingual subject without dashes", () => {
    const { subject } = buildConfirmationEmail(base);
    expect(subject).toBe("تأكيد التسجيل في حملة التبرع بالدم | Blood donation registration confirmed");
    expect(subject).not.toMatch(/[-–—]/);
  });
  it("renders the Arabic block first, then English, with ref and deletion lines", () => {
    const { html, text } = buildConfirmationEmail(base);
    expect(html.indexOf('dir="rtl"')).toBeGreaterThan(-1);
    expect(html.indexOf('dir="rtl"')).toBeLessThan(html.indexOf('dir="ltr"'));
    expect(html).toContain("#A1B2C3D4");
    expect(html).toContain("لطلب حذف بياناتك، راسلنا على info@example.org");
    expect(html).toContain("To request deletion of your data, email info@example.org.");
    expect(text).toContain("#A1B2C3D4");
  });
  it("escapes interpolated values", () => {
    const { html } = buildConfirmationEmail({ ...base, fullName: "<script>alert(1)</script>" });
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(escapeHtml(`a&b"c'`)).toBe("a&amp;b&quot;c&#39;");
  });
  it("never contains the CPR or screening data", () => {
    const withExtras = { ...base, cpr: "990101123", phone: "33334444" } as typeof base;
    const { html, text } = buildConfirmationEmail(withExtras);
    expect(html).not.toContain("990101123");
    expect(text).not.toContain("990101123");
    expect(html).not.toContain("33334444");
  });
});

const sendMock = vi.fn();
vi.mock("resend", () => ({
  Resend: class {
    emails = { send: sendMock };
  },
}));

describe("sendConfirmationEmail", () => {
  beforeEach(() => {
    sendMock.mockReset();
    process.env.RESEND_API_KEY = "re_test";
    process.env.RESEND_FROM_EMAIL = "Org <noreply@example.org>";
  });
  it("attaches donor-card.pdf and sets replyTo", async () => {
    sendMock.mockResolvedValue({ data: { id: "1" }, error: null });
    const { sendConfirmationEmail } = await import("@/lib/email/send");
    const r = await sendConfirmationEmail(base, Buffer.from("%PDF-x"));
    expect(r).toEqual({ ok: true });
    const arg = sendMock.mock.calls[0]![0];
    expect(arg.attachments[0].filename).toBe("donor-card.pdf");
    expect(arg.to).toBe("ali@example.com");
    expect(arg.replyTo).toBe("info@example.org");
  });
  it("maps a Resend error to ok:false", async () => {
    sendMock.mockResolvedValue({ data: null, error: { message: "domain not verified" } });
    const { sendConfirmationEmail } = await import("@/lib/email/send");
    expect(await sendConfirmationEmail(base, Buffer.from("x"))).toEqual({ ok: false, error: "domain not verified" });
  });
  it("returns ok:false when Resend is not configured", async () => {
    delete process.env.RESEND_API_KEY;
    const { sendConfirmationEmail } = await import("@/lib/email/send");
    expect((await sendConfirmationEmail(base, Buffer.from("x"))).ok).toBe(false);
    expect(sendMock).not.toHaveBeenCalled();
  });
});
