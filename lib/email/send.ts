import "server-only";
import nodemailer from "nodemailer";
import { Resend } from "resend";
import { emailConfig } from "@/lib/env";
import { buildConfirmationEmail, type ConfirmationEmailData } from "@/lib/email/templates";

/** Safe summary of an SMTP failure: code and a short message only, never the server response, command or an address. */
function smtpError(e: unknown): string {
  const err = (e ?? {}) as { code?: unknown; responseCode?: unknown; message?: unknown };
  const code = typeof err.code === "string" ? err.code : undefined;
  const responseCode = typeof err.responseCode === "number" ? err.responseCode : undefined;
  const message = typeof err.message === "string" ? err.message : "unknown";
  return `smtp ${code ?? "error"}${responseCode ? " " + responseCode : ""}: ${message.slice(0, 160)}`;
}

export async function sendConfirmationEmail(
  data: ConfirmationEmailData,
  pdf: Buffer,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const cfg = emailConfig();
  if (!cfg) return { ok: false, error: "email is not configured" };
  const { subject, html, text } = buildConfirmationEmail(data);

  if (cfg.provider === "resend") {
    const { error } = await new Resend(cfg.apiKey).emails.send({
      from: cfg.from,
      to: data.emailTo,
      subject,
      html,
      text,
      replyTo: data.org.email || undefined,
      attachments: [{ filename: "donor-card.pdf", content: pdf }],
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  }

  const transport = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user: cfg.user, pass: cfg.appPassword },
    connectionTimeout: 8_000,
    greetingTimeout: 8_000,
    socketTimeout: 10_000,
  });
  try {
    await transport.sendMail({
      from: { name: cfg.fromName, address: cfg.user }, // From must be the Gmail account itself
      to: data.emailTo,
      subject,
      html,
      text,
      replyTo: data.org.email || undefined,
      attachments: [{ filename: "donor-card.pdf", content: pdf, contentType: "application/pdf" }],
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: smtpError(e) };
  } finally {
    transport.close();
  }
}
