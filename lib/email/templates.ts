import "server-only";
import { formatDate, formatSlot } from "@/lib/format";
import type { DonorCardData } from "@/lib/pdf/donor-card-pdf";
import { ar } from "@/lib/i18n/dictionaries/ar";
import { en } from "@/lib/i18n/dictionaries/en";
import { t, type Dictionary, type Locale } from "@/lib/i18n";

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export type ConfirmationEmailData = DonorCardData & { emailTo: string };

type Line = { label: string; value: string };

function lines(data: DonorCardData, locale: Locale, d: Dictionary): Line[] {
  const out: Line[] = [
    { label: d.email.date, value: formatDate(data.event.event_date, locale) },
  ];
  const location = locale === "ar" ? data.event.location_ar : data.event.location_en;
  if (location) out.push({ label: d.email.location, value: location });
  if (data.slotTime) out.push({ label: d.email.time, value: formatSlot(data.slotTime, locale) });
  if (data.queueNumber !== null) out.push({ label: d.email.queue, value: `#${data.queueNumber}` });
  out.push({ label: d.email.ref, value: `#${data.ref}` });
  return out;
}

function deletion(d: Dictionary, contactEmail: string): string {
  return contactEmail ? t(d.email.deletion, { email: contactEmail }) : d.email.deletion_no_contact;
}

function blockHtml(data: DonorCardData, locale: Locale): string {
  const d = locale === "ar" ? ar : en;
  const rtl = locale === "ar";
  const eventName = rtl ? data.event.name_ar : data.event.name_en;
  const rows = lines(data, locale, d)
    .map((l) => `<p style="margin:4px 0;"><strong>${escapeHtml(l.label)}:</strong> <span dir="auto">${escapeHtml(l.value)}</span></p>`)
    .join("");
  return `<div dir="${rtl ? "rtl" : "ltr"}" lang="${locale}" style="text-align:${rtl ? "right" : "left"};">
<h2 style="color:#9C1F2E;margin:0 0 8px;">${escapeHtml(d.email.greeting)}</h2>
<p style="margin:4px 0;">${escapeHtml(t(d.email.body, { event: eventName }))}</p>
<p style="margin:4px 0;"><strong dir="auto">${escapeHtml(data.fullName)}</strong></p>
${rows}
<p style="margin:10px 0 4px;">${escapeHtml(d.email.bring_cpr)}</p>
<p style="margin:4px 0;">${escapeHtml(d.email.card_attached)}</p>
<p style="margin:10px 0 4px;font-size:12px;color:#6B6259;">${escapeHtml(d.common.disclaimer)}</p>
<p style="margin:4px 0;font-size:12px;color:#6B6259;">${escapeHtml(deletion(d, data.org.email))}</p>
</div>`;
}

function blockText(data: DonorCardData, locale: Locale): string {
  const d = locale === "ar" ? ar : en;
  const eventName = locale === "ar" ? data.event.name_ar : data.event.name_en;
  return [
    d.email.greeting,
    t(d.email.body, { event: eventName }),
    data.fullName,
    ...lines(data, locale, d).map((l) => `${l.label}: ${l.value}`),
    d.email.bring_cpr,
    d.email.card_attached,
    d.common.disclaimer,
    deletion(d, data.org.email),
  ].join("\n");
}

/** Always bilingual: Arabic block first, then English. No CPR, phone or screening data. */
export function buildConfirmationEmail(data: ConfirmationEmailData): { subject: string; html: string; text: string } {
  const subject = `${ar.email.subject} | ${en.email.subject}`;
  const html = `<div style="max-width:560px;margin:0 auto;font-family:Arial,Helvetica,sans-serif;color:#241F1C;font-size:15px;line-height:1.5;">
${blockHtml(data, "ar")}
<hr style="border:none;border-top:1px solid #E1D5C6;margin:20px 0;">
${blockHtml(data, "en")}
</div>`;
  const text = `${blockText(data, "ar")}\n\n----\n\n${blockText(data, "en")}\n`;
  return { subject, html, text };
}

