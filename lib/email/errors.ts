import "server-only";

/** True when the send error string (from smtpError in lib/email/send.ts) is an SMTP authentication failure. */
export function isEmailAuthError(error: string): boolean {
  return /^smtp EAUTH\b/.test(error);
}
