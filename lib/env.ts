import "server-only";
import { z } from "zod";
import { GMAIL_DEFAULT_BUDGET, RESEND_DEFAULT_BUDGET } from "@/lib/config";

const serverSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  TURNSTILE_SECRET_KEY: z.string().min(1),
  RATE_LIMIT_SALT: z.string().min(1),
  CRON_SECRET: z.string().min(1),
  EMAIL_PROVIDER: z.string().optional(),
  GMAIL_USER: z.string().optional(),
  GMAIL_APP_PASSWORD: z.string().optional(),
  GMAIL_FROM_NAME: z.string().optional(),
  DISCORD_WEBHOOK_URL: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM_EMAIL: z.string().optional(),
  EMAIL_DAILY_BUDGET: z.coerce.number().int().min(0).default(95),
  NEXT_PUBLIC_SITE_URL: z.string().optional(),
  NEXT_PUBLIC_ORG_NAME: z.string().optional(),
  NEXT_PUBLIC_ORG_CONTACT_EMAIL: z.string().optional(),
  NEXT_PUBLIC_ORG_CONTACT_PHONE: z.string().optional(),
});

export type ServerEnv = z.infer<typeof serverSchema>;

let cached: ServerEnv | null = null;

function blankToUndefined(v: string | undefined): string | undefined {
  return v === undefined || v === "" ? undefined : v;
}

/** Lazy, cached, validated server env. Never call at module top level (the build runs without env). */
export function serverEnv(): ServerEnv {
  if (cached) return cached;
  const raw: Record<string, string | undefined> = {};
  for (const key of Object.keys(serverSchema.shape)) raw[key] = blankToUndefined(process.env[key]);
  const parsed = serverSchema.safeParse(raw);
  if (!parsed.success) {
    const names = [...new Set(parsed.error.issues.map((i) => String(i.path[0])))].join(", ");
    throw new Error(`Invalid or missing environment variables: ${names}`);
  }
  cached = parsed.data;
  return cached;
}

/** For tests only. */
export function resetEnvCache(): void {
  cached = null;
}

export type EmailConfig =
  | { provider: "gmail"; user: string; appPassword: string; fromName: string }
  | { provider: "resend"; apiKey: string; from: string };

function gmailConfig(): Extract<EmailConfig, { provider: "gmail" }> | null {
  const user = blankToUndefined(process.env.GMAIL_USER)?.trim();
  const pass = blankToUndefined(process.env.GMAIL_APP_PASSWORD);
  if (!user || !/^[^\s@<>"]+@[^\s@<>"]+$/.test(user) || !pass) return null;
  const appPassword = pass.replace(/\s+/g, "");
  if (!appPassword) return null;
  const rawName = blankToUndefined(process.env.GMAIL_FROM_NAME) ?? (orgInfo().name || "Blood Donation Registration");
  const fromName =
    rawName.replace(/[\r\n"<>]/g, "").trim().slice(0, 64).trim() || "Blood Donation Registration";
  return { provider: "gmail", user, appPassword, fromName };
}

function resendConfig(): Extract<EmailConfig, { provider: "resend" }> | null {
  const apiKey = blankToUndefined(process.env.RESEND_API_KEY);
  const from = blankToUndefined(process.env.RESEND_FROM_EMAIL);
  if (!apiKey || !from) return null;
  return { provider: "resend", apiKey, from };
}

/** Null when email is not configured (emails then stay queued). */
export function emailConfig(): EmailConfig | null {
  const forced = blankToUndefined(process.env.EMAIL_PROVIDER);
  if (forced === "gmail") return gmailConfig();
  if (forced === "resend") return resendConfig();
  if (forced !== undefined) return null;
  return gmailConfig() ?? resendConfig();
}

export function emailDailyBudget(): number {
  const raw = process.env.EMAIL_DAILY_BUDGET;
  const n = Number(raw);
  if (raw !== undefined && raw !== "" && Number.isInteger(n) && n >= 0) return n;
  return emailConfig()?.provider === "gmail" ? GMAIL_DEFAULT_BUDGET : RESEND_DEFAULT_BUDGET;
}

export function orgInfo(): { name: string; email: string; phone: string } {
  return {
    name: process.env.NEXT_PUBLIC_ORG_NAME ?? "",
    email: process.env.NEXT_PUBLIC_ORG_CONTACT_EMAIL ?? "",
    phone: process.env.NEXT_PUBLIC_ORG_CONTACT_PHONE ?? "",
  };
}
