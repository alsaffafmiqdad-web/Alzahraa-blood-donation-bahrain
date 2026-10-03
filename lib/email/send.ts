import "server-only";
import { Resend } from "resend";
import { resendConfig } from "@/lib/env";
import { buildConfirmationEmail, type ConfirmationEmailData } from "@/lib/email/templates";

export async function sendConfirmationEmail(
  data: ConfirmationEmailData,
  pdf: Buffer,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const cfg = resendConfig();
  if (!cfg) return { ok: false, error: "Resend is not configured" };
  const { subject, html, text } = buildConfirmationEmail(data);
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
