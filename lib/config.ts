export const LOCALES = ["ar", "en"] as const;
export const DEFAULT_LOCALE = "ar";
export const TIMEZONE = "Asia/Bahrain";
export const RETENTION_MONTHS = 3;
export const AGE_MIN = 18;
export const AGE_MAX = 65;
export const SIGNUP_RATE_LIMIT = { limit: 25, windowSeconds: 600 };
/** Failed admin sign-ins allowed per hashed client IP per window. */
export const LOGIN_RATE_LIMIT = { limit: 10, windowSeconds: 900 };
export const EMAIL_MAX_ATTEMPTS = 5;
/** Default emails per rolling 24h: Gmail allows about 500, Resend free plan 100. */
export const GMAIL_DEFAULT_BUDGET = 450;
export const RESEND_DEFAULT_BUDGET = 95;
/** Cron: stop starting new emails after this many ms (maxDuration is 300 s; leave room to finish in-flight sends). */
export const CRON_SOFT_DEADLINE_MS = 240_000;
export const EMAIL_CONCURRENCY = 5;
export const MAX_SIGNUP_BODY_BYTES = 10_000;
export const STATUSES = [
  "registered",
  "verified",
  "waiting",
  "screening",
  "donated",
  "deferred",
  "no_show",
] as const;
export const BLOOD_TYPES = ["unknown", "A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"] as const;
export const SOURCES = ["self_signup", "admin_added", "walk_in"] as const;
// Owner decision: only two screening questions are asked. Everything else is asked in person on the day.
export const SCREENING_KEYS = ["recentDonation", "onMedication"] as const;
