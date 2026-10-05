import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { emailConfig, emailDailyBudget } from "@/lib/env";

const KEYS = ["EMAIL_PROVIDER", "GMAIL_USER", "GMAIL_APP_PASSWORD", "GMAIL_FROM_NAME", "RESEND_API_KEY", "RESEND_FROM_EMAIL", "EMAIL_DAILY_BUDGET", "NEXT_PUBLIC_ORG_NAME"];
const gmail = { GMAIL_USER: "drive@gmail.com", GMAIL_APP_PASSWORD: "abcd efgh ijkl mnop" };
const resend = { RESEND_API_KEY: "re_x", RESEND_FROM_EMAIL: "Org <n@example.org>" };
const setEnv = (e: Record<string, string>) => Object.assign(process.env, e);

beforeEach(() => KEYS.forEach((k) => delete process.env[k]));
afterEach(() => KEYS.forEach((k) => delete process.env[k]));

describe("emailConfig", () => {
  it("is null when nothing is set", () => expect(emailConfig()).toBeNull());
  it("unset provider: Gmail first, then Resend", () => {
    setEnv({ ...gmail, ...resend });
    expect(emailConfig()?.provider).toBe("gmail");
    delete process.env.GMAIL_USER;
    expect(emailConfig()?.provider).toBe("resend");
  });
  it("forced providers", () => {
    setEnv({ ...gmail, ...resend, EMAIL_PROVIDER: "resend" });
    expect(emailConfig()?.provider).toBe("resend");
    process.env.EMAIL_PROVIDER = "gmail";
    expect(emailConfig()?.provider).toBe("gmail");
    delete process.env.GMAIL_APP_PASSWORD;
    expect(emailConfig()).toBeNull();
    process.env.EMAIL_PROVIDER = "other";
    expect(emailConfig()).toBeNull();
  });
  it("Gmail needs a valid address and a password", () => {
    setEnv({ GMAIL_USER: "not an email", GMAIL_APP_PASSWORD: "x" });
    expect(emailConfig()).toBeNull();
  });
  it("strips spaces from the app password", () => {
    setEnv(gmail);
    expect(emailConfig()).toMatchObject({ provider: "gmail", appPassword: "abcdefghijklmnop" });
  });
  it("sanitises the from name", () => {
    setEnv({ ...gmail, GMAIL_FROM_NAME: '  "Bad"\r\n<Name> ' + "x".repeat(100) });
    const c = emailConfig();
    expect(c && c.provider === "gmail" && c.fromName).toMatch(/^BadName x+$/);
    expect(c && c.provider === "gmail" && c.fromName.length).toBeLessThanOrEqual(64);
  });
  it("falls back to the org name, then a default", () => {
    setEnv({ ...gmail, NEXT_PUBLIC_ORG_NAME: "Alzahraa" });
    expect(emailConfig()).toMatchObject({ fromName: "Alzahraa" });
    delete process.env.NEXT_PUBLIC_ORG_NAME;
    expect(emailConfig()).toMatchObject({ fromName: "Blood Donation Registration" });
  });
});

describe("emailDailyBudget", () => {
  it("defaults by provider", () => {
    setEnv(gmail);
    expect(emailDailyBudget()).toBe(450);
    KEYS.forEach((k) => delete process.env[k]);
    setEnv(resend);
    expect(emailDailyBudget()).toBe(95);
  });
  it("an explicit value wins", () => {
    setEnv({ ...gmail, EMAIL_DAILY_BUDGET: "7" });
    expect(emailDailyBudget()).toBe(7);
    process.env.EMAIL_DAILY_BUDGET = "0";
    expect(emailDailyBudget()).toBe(0);
    process.env.EMAIL_DAILY_BUDGET = "abc";
    expect(emailDailyBudget()).toBe(450);
  });
});
