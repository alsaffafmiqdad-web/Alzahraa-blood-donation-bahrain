<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Project notes for agents

Read [README.md](README.md) first, then [docs/architecture.md](docs/architecture.md). Setup and operations are in [docs/setup.md](docs/setup.md) and [docs/operations.md](docs/operations.md).

## Ground rules

- This is a **public repository**. Never commit secrets, keys, tokens, passwords, hosted project refs or IDs, or real donor data. Use placeholders such as `<your-project-ref>` in docs.
- Don't push, merge, deploy or run `supabase db push` against the hosted project unless the user asks for it in this conversation.

## Owner decisions (don't re-ask)

- One blood drive with event-day operations (time slots, check-in, status history, queue numbers), not an ongoing registry.
- Arabic first (right to left), with English. The admin panel is English only.
- Screening is two questions (recent donation, medication), plus an age check. Answers only flag a donor; they never block registration.
- The CPR number is the unique duplicate key. The CPR card photo is required, except for event-day walk-ins, where it's optional.
- Walk-in mode starts at the event start time on the event date (Bahrain time). Online walk-ins get a queue number automatically, from the same sequence as desk check-in. The start number is editable on `/admin/event`.
- The signup rate limit stays at 25 per IP per 10 minutes.
- The donor's PDF (download and email) is the same A4 Donor Registration Form the admins print, including the full CPR, flags and notes. `lib/pdf/RegistrationForm.tsx` must mirror `components/admin/PrintForm.tsx`; change both together.

## Conventions

- **The server decides.** Walk-in mode, flags and queue numbers are worked out on the server. Never trust client input for them.
- **Server-only code.** Anything touching the service role, email or the PDF imports `server-only`. Admin pages and actions call `requireAdmin()` first.
- **No personal data in URLs or logs.** Log donor IDs only.
- **Copy.** User-facing text lives in `lib/i18n/dictionaries/` (`ar.ts` and `en.ts` must have the same keys). Don't use em or en dashes in copy; a test enforces this.
- **Database.** Migrations are forward-only, so add a new file and don't edit an applied one. Revoke execute from `public`, `anon` and `authenticated` on new functions. Apply new migrations locally with `pnpm dlx supabase migration up --local`.
- **Tests.** Vitest runs in a Node environment with no DOM: component tests use `renderToStaticMarkup`, and pure logic goes in `lib/` so it can be tested. Before handing back work, run `pnpm test`, `pnpm typecheck`, `pnpm exec eslint lib components app tests` and, for SQL changes, `bash supabase/sql-tests/run.sh`.
