import { beforeEach, describe, expect, it, vi } from "vitest";

const nm = vi.hoisted(() => ({ sendMail: vi.fn(), close: vi.fn(), createTransport: vi.fn() }));
vi.mock("nodemailer", () => ({ default: { createTransport: nm.createTransport } }));

vi.mock("@/lib/email/templates", () => ({ buildConfirmationEmail: () => ({ subject: "s", html: "<p>h</p>", text: "t" }) }));

import { sendConfirmationEmail } from "@/lib/email/send";

const data = {
  emailTo: "donor@example.com",
  org: { name: "Org", email: "org@example.org", phone: "" },
} as unknown as Parameters<typeof sendConfirmationEmail>[0];

beforeEach(() => {
  vi.clearAllMocks();
  nm.createTransport.mockReturnValue({ sendMail: nm.sendMail, close: nm.close });
  nm.sendMail.mockResolvedValue({});
  process.env.GMAIL_USER = "drive@gmail.com";
  process.env.GMAIL_APP_PASSWORD = "abcd efgh ijkl mnop";
});

describe("sendConfirmationEmail via Gmail", () => {
  it("sends from the Gmail account with reply-to and the PDF attached", async () => {
    expect(await sendConfirmationEmail(data, Buffer.from("%PDF"))).toEqual({ ok: true });
    const opts = nm.sendMail.mock.calls[0]![0];
    expect(opts.from.address).toBe("drive@gmail.com");
    expect(opts.replyTo).toBe("org@example.org");
    expect(opts.attachments[0]).toMatchObject({ filename: "donor-card.pdf", contentType: "application/pdf" });
    expect(nm.createTransport.mock.calls[0]![0]).toMatchObject({ host: "smtp.gmail.com", port: 465, secure: true });
    expect(nm.close).toHaveBeenCalledTimes(1);
  });
  it("returns a safe error without the server response or an address, and still closes", async () => {
    nm.sendMail.mockRejectedValue({ code: "EAUTH", responseCode: 535, response: "535 user@x.com bad", message: "Invalid login" });
    const r = await sendConfirmationEmail(data, Buffer.from("%PDF"));
    expect(r.ok).toBe(false);
    const error = !r.ok ? r.error : "";
    expect(error.startsWith("smtp EAUTH 535")).toBe(true);
    expect(error).not.toContain("user@x.com");
    expect(nm.close).toHaveBeenCalledTimes(1);
  });
  it("removes recipient addresses from an SMTP message", async () => {
    nm.sendMail.mockRejectedValue({
      code: "EENVELOPE",
      message: "Can't send mail - all recipients were rejected: 550 5.1.1 <donor@example.com> nope",
    });
    const r = await sendConfirmationEmail(data, Buffer.from("%PDF"));
    const error = !r.ok ? r.error : "";
    expect(error).not.toContain("donor@example.com");
    expect(error).toContain("[email]");
  });
  it("is not configured without any provider", async () => {
    delete process.env.GMAIL_USER;
    expect(await sendConfirmationEmail(data, Buffer.from("x"))).toEqual({ ok: false, error: "email is not configured" });
  });
});
