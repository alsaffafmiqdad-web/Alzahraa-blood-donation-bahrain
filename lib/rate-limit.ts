import "server-only";
import { createHash } from "node:crypto";
import { LOGIN_RATE_LIMIT, SIGNUP_RATE_LIMIT } from "@/lib/config";
import { serverEnv } from "@/lib/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export function ipFromHeaders(headers: Pick<Headers, "get">): string | null {
  const real = headers.get("x-real-ip")?.trim();
  if (real) return real;
  const fwd = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return fwd || null;
}

export function clientIp(req: Request): string | null {
  return ipFromHeaders(req.headers);
}

function loginKey(ip: string): string {
  return "login:" + createHash("sha256").update(serverEnv().RATE_LIMIT_SALT + ip).digest("hex");
}

/**
 * Admin sign-in limit, counting failures only. True = this IP may try. Read-only; fails open on a
 * database error, and when there is no client IP (a shared bucket could lock every admin out).
 */
export async function checkLoginRateLimit(ip: string | null): Promise<boolean> {
  if (!ip) return true;
  try {
    const { data, error } = await createSupabaseAdminClient().rpc("rate_limit_peek", {
      p_key: loginKey(ip),
      p_limit: LOGIN_RATE_LIMIT.limit,
      p_window_seconds: LOGIN_RATE_LIMIT.windowSeconds,
    });
    if (error) {
      console.error(`login rate limit error: ${error.message}`);
      return true;
    }
    return data === true;
  } catch (e) {
    console.error(`login rate limit error: ${e instanceof Error ? e.message : "unknown"}`);
    return true;
  }
}

/** Counts one failed sign-in for this IP. Never throws. */
export async function recordLoginFailure(ip: string | null): Promise<void> {
  if (!ip) return;
  try {
    const { error } = await createSupabaseAdminClient().rpc("rate_limit_hit", {
      p_key: loginKey(ip),
      p_limit: LOGIN_RATE_LIMIT.limit,
      p_window_seconds: LOGIN_RATE_LIMIT.windowSeconds,
    });
    if (error) console.error(`login rate limit error: ${error.message}`);
  } catch (e) {
    console.error(`login rate limit error: ${e instanceof Error ? e.message : "unknown"}`);
  }
}

function signupKey(ip: string | null): string {
  return ip
    ? "signup:" + createHash("sha256").update(serverEnv().RATE_LIMIT_SALT + ip).digest("hex")
    : "signup:unknown";
}

/**
 * Read-only check: true = this IP is still under the limit. Does NOT count a hit, so requests that
 * fail validation or Turnstile never use up the quota. Fails open on a database error.
 */
export async function checkSignupRateLimit(ip: string | null): Promise<boolean> {
  try {
    const { data, error } = await createSupabaseAdminClient().rpc("rate_limit_peek", {
      p_key: signupKey(ip),
      p_limit: SIGNUP_RATE_LIMIT.limit,
      p_window_seconds: SIGNUP_RATE_LIMIT.windowSeconds,
    });
    if (error) {
      console.error(`rate limit error: ${error.message}`);
      return true;
    }
    return data === true;
  } catch (e) {
    console.error(`rate limit error: ${e instanceof Error ? e.message : "unknown"}`);
    return true;
  }
}

/**
 * Counts one hit. Call it only after the request passed Zod and Turnstile.
 * True = allowed. Fails open on a database error (Turnstile has already been enforced).
 */
export async function recordSignupAttempt(ip: string | null): Promise<boolean> {
  try {
    const { data, error } = await createSupabaseAdminClient().rpc("rate_limit_hit", {
      p_key: signupKey(ip),
      p_limit: SIGNUP_RATE_LIMIT.limit,
      p_window_seconds: SIGNUP_RATE_LIMIT.windowSeconds,
    });
    if (error) {
      console.error(`rate limit error: ${error.message}`);
      return true;
    }
    return data === true;
  } catch (e) {
    console.error(`rate limit error: ${e instanceof Error ? e.message : "unknown"}`);
    return true;
  }
}
