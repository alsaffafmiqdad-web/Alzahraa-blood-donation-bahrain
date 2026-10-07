import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { serverEnv } from "@/lib/env";

/**
 * A short-lived, signed token that lets the person who just registered download their own donor
 * card from the success page for 2 hours. Format: `<donorId>.<expiresEpochSeconds>.<base64url hmac>`.
 * The key is derived from RATE_LIMIT_SALT with a fixed label (domain separation), so no extra
 * environment variable is needed. The token never goes into a URL: it travels in the signup JSON
 * response, sessionStorage and a POST body.
 */
export const CARD_LINK_TTL_SECONDS = 2 * 60 * 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function key(): Buffer {
  return createHmac("sha256", serverEnv().RATE_LIMIT_SALT).update("donor-card-link-v1").digest();
}

function sign(payload: string): string {
  return createHmac("sha256", key()).update(payload).digest("base64url");
}

export function createCardToken(donorId: string, nowMs: number = Date.now()): string {
  const exp = Math.floor(nowMs / 1000) + CARD_LINK_TTL_SECONDS;
  const payload = `${donorId}.${exp}`;
  return `${payload}.${sign(payload)}`;
}

/** Returns the donor id for a valid, unexpired token, otherwise null. */
export function verifyCardToken(token: unknown, nowMs: number = Date.now()): string | null {
  if (typeof token !== "string" || token.length > 200) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [donorId, expRaw, sig] = parts as [string, string, string];
  if (!UUID.test(donorId) || !/^\d{1,12}$/.test(expRaw)) return null;
  const expected = Buffer.from(sign(`${donorId}.${expRaw}`));
  const given = Buffer.from(sig);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  if (Number(expRaw) * 1000 < nowMs) return null;
  return donorId;
}
