import { afterEach, vi } from "vitest";
import { flushAfter } from "./helpers/after";

vi.mock("server-only", () => ({}));

// after() needs a live request scope. In tests it starts the task straight away; await
// flushAfter() from tests/helpers/after.ts to wait for it.
vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  const g = globalThis as { __afterTasks?: Promise<unknown>[] };
  return {
    ...actual,
    after: (task: unknown) => {
      (g.__afterTasks ??= []).push(Promise.resolve().then(() => (typeof task === "function" ? task() : task)));
    },
  };
});

// Finish each test's after() work inside that test, so it can't run against the next test's mocks.
afterEach(flushAfter);

// The Resend-based tests must not pick up a developer's Gmail settings.
for (const key of ["EMAIL_PROVIDER", "GMAIL_USER", "GMAIL_APP_PASSWORD", "GMAIL_FROM_NAME", "DISCORD_WEBHOOK_URL"]) {
  delete process.env[key];
}
