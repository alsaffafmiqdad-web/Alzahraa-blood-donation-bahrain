import { vi } from "vitest";

vi.mock("server-only", () => ({}));

// The Resend-based tests must not pick up a developer's Gmail settings.
for (const key of ["EMAIL_PROVIDER", "GMAIL_USER", "GMAIL_APP_PASSWORD", "GMAIL_FROM_NAME", "DISCORD_WEBHOOK_URL"]) {
  delete process.env[key];
}
