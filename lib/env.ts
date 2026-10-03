import "server-only";
import { z } from "zod";

const serverSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  TURNSTILE_SECRET_KEY: z.string().min(1),
  RATE_LIMIT_SALT: z.string().min(1),
  CRON_SECRET: z.string().min(1),
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

/** Optional email config. Returns null when email is not configured (email is then skipped). */
export function resendConfig(): { apiKey: string; from: string } | null {
  const apiKey = blankToUndefined(process.env.RESEND_API_KEY);
  const from = blankToUndefined(process.env.RESEND_FROM_EMAIL);
  if (!apiKey || !from) return null;
  return { apiKey, from };
}

export function emailDailyBudget(): number {
  const n = Number(process.env.EMAIL_DAILY_BUDGET);
  return Number.isInteger(n) && n >= 0 && process.env.EMAIL_DAILY_BUDGET !== "" ? n : 95;
}

export function orgInfo(): { name: string; email: string; phone: string } {
  return {
    name: process.env.NEXT_PUBLIC_ORG_NAME ?? "",
    email: process.env.NEXT_PUBLIC_ORG_CONTACT_EMAIL ?? "",
    phone: process.env.NEXT_PUBLIC_ORG_CONTACT_PHONE ?? "",
  };
}
