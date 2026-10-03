// Client-safe: must never reference server-only variables (this file is bundled into the browser).
/** Client-safe values. NEXT_PUBLIC_* must be referenced literally so Next can inline them. */
export const publicEnv = {
  siteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? "",
  turnstileSiteKey: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "",
  orgName: process.env.NEXT_PUBLIC_ORG_NAME ?? "",
  orgContactEmail: process.env.NEXT_PUBLIC_ORG_CONTACT_EMAIL ?? "",
  orgContactPhone: process.env.NEXT_PUBLIC_ORG_CONTACT_PHONE ?? "",
};
