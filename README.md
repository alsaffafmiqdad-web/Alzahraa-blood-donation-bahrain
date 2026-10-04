# Alzahraa blood donation registration

A bilingual (Arabic and English) web app for the Alzahraa blood donation drive. Donors register online before the event or as walk-ins on the day; organisers run check-in, the queue and printing from an admin panel.

## Features

- **Public signup** at `/ar/join` and `/en/join`: an accessible step-by-step form, Arabic first, with a CPR card photo, two screening questions and a confirmation email with the donor's registration form as a PDF.
- **Event-day walk-ins:** from the event start time, the form registers donors as walk-ins with no time slot and gives them a queue number straight away.
- **Admin panel** at `/admin` (English): donors, check-in and queue numbers, outcomes, printing, slots, event settings, CSV export and admin accounts.
- Screening answers only flag a donor for review; they never block registration.

## Tech stack

Next.js 16 (App Router, TypeScript), Tailwind CSS 4 and shadcn/ui, Supabase (Postgres, Auth, Storage), Resend, `@react-pdf/renderer`, Zod, Cloudflare Turnstile, Vercel and Vitest.

## Getting started

Requirements: Node 20.9 or newer, pnpm 11 (pinned in `package.json`) and Docker for the local database.

```bash
pnpm install --frozen-lockfile
cp .env.example .env.local          # fill in the values; test keys are noted in the file
pnpm dlx supabase start             # local Postgres, Auth and Storage; prints the local keys
pnpm admin:local you@example.org 'a-password-of-12-or-more'
pnpm dev                            # http://localhost:3000
```

Sign in at http://localhost:3000/admin/login. See [docs/setup.md](docs/setup.md) for details.

## Scripts

| Command | What it does |
| --- | --- |
| `pnpm dev` | Start the dev server |
| `pnpm test` | Unit and route tests (offline) |
| `pnpm typecheck` / `pnpm lint` / `pnpm build` | Static checks and production build |
| `bash supabase/sql-tests/run.sh` | SQL tests against a local Postgres |
| `pnpm dlx supabase test db` | pgTAP tests on the local Supabase database |

## Documentation

- [docs/setup.md](docs/setup.md): local development, hosted services and CI/CD.
- [docs/operations.md](docs/operations.md): admins, backups, data deletion and the launch checklist.
- [docs/architecture.md](docs/architecture.md): how the app is put together and its security model.

## Security

Never commit secrets. Configuration goes in `.env.local` locally and in the Vercel and GitHub settings in production; `.env.example` lists the names. Report security problems privately to the maintainers rather than in a public issue.
