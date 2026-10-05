# Setup

How to run the app locally and set up the hosted services. Never put real keys, passwords or tokens in this repository: they go in `.env.local` (git-ignored) locally, and in the Vercel and GitHub settings in production.

## Local development

Requirements: Node 20.9 or newer (developed on Node 24), pnpm 11 and Docker. Run the Supabase CLI with `pnpm dlx supabase ...` or install it.

1. `pnpm install --frozen-lockfile`, then `cp .env.example .env.local`.
2. `pnpm dlx supabase start` starts Postgres, Auth, Storage and the API, and applies `supabase/migrations/`. It prints the local URL and keys; `pnpm dlx supabase status -o env` shows them again.
3. In `.env.local`, set `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321`, the local anon or publishable key, the local service_role or secret key, the Turnstile test keys noted in `.env.example`, and any random `CRON_SECRET` and `RATE_LIMIT_SALT`.
4. Create a local admin: `pnpm admin:local you@example.org 'a-password-of-12-or-more'` (an optional third argument sets the display name). The script refuses to run unless the Supabase URL is `localhost` or `127.0.0.1`, so it can't create users in a hosted project.
5. `pnpm dev`, then sign in at http://localhost:3000/admin/login. The local mail inbox is at http://127.0.0.1:54324 and Studio at http://127.0.0.1:54323.
6. `pnpm dlx supabase stop` when done (add `--no-backup` to drop the data).

`pnpm dlx supabase db reset` rebuilds the local database from the migrations and runs `supabase/seed.sql`, which creates an event and the time slots. The seed is local only: it never runs on `supabase db push`.

When new migrations arrive, apply them to the local database with `pnpm dlx supabase migration up --local`. If Storage was off when a migration that creates a bucket ran, restart Supabase and re-run that part, or use `db reset`.

`supabase/config.toml` turns off self sign-up, requires 12-character passwords, enables Storage, and switches off realtime, edge functions and analytics, which the app doesn't use.

## Tests

- `pnpm test`: unit and route tests. They run offline in a Node environment (no browser DOM).
- `bash supabase/sql-tests/run.sh`: the plain Postgres suite (row level security, triggers, check-in, queue numbers, rate limit, email budget and concurrency). It needs `psql`, `pgbench` and a local Postgres it can create a scratch database on. Don't point it at a database you care about.
- `pnpm dlx supabase test db`: the pgTAP tests in `supabase/tests/`, on the local Supabase database.

## Supabase (hosted)

1. Create the project under the organisation's account. Choose the region first; it can't be changed later. The app is set up for Mumbai (`ap-south-1`) with the Vercel function region `bom1` in `vercel.json`. Frankfurt (`eu-central-1`, Vercel `fra1`) is the alternative.
2. Copy the project URL, the publishable key and the secret key into the Vercel environment variables.
3. In Authentication > Providers > Email, turn off "Allow new users to sign up".

### Migrations

Merging to `main` applies new migrations automatically (see CI/CD below). To apply them by hand:

```bash
pnpm dlx supabase link --project-ref <your-project-ref>
pnpm dlx supabase db push --dry-run    # check what will be applied
pnpm dlx supabase db push
```

If you ever paste a migration into the SQL editor instead, record it as applied with `supabase migration repair --status applied <version>`, or the next automatic deploy will try to apply it again and fail. Migrations are forward only: to undo one, write a new migration.

## Email (Gmail, with Resend as fallback)

**Gmail (preferred).** Create a Gmail account just for the drive, turn on 2-Step Verification, and add a second organiser as a recovery contact. Then create an app password (Google Account > Security > App passwords) and set `GMAIL_USER`, `GMAIL_APP_PASSWORD` and, optionally, `GMAIL_FROM_NAME`. Never use the normal account password. Changing the Google password revokes its app passwords. Mail is always sent From the Gmail address; Reply-To is the organisation contact email.

**Resend (fallback).** Verify a sending domain (SPF and DKIM), create an API key, and set `RESEND_API_KEY` and `RESEND_FROM_EMAIL`. It is used only when the Gmail variables are not set. `EMAIL_PROVIDER` (`gmail` or `resend`) forces one of them.

Without either, signups still work and emails stay queued.

The app keeps a rolling 24-hour budget (`EMAIL_DAILY_BUDGET`). If you leave it empty the default is 450 for Gmail (Gmail allows about 500 a day, shared with any manual sending from the account) and 95 for Resend (free plan: 100). A signup sends straight away if the budget allows; otherwise the email waits for the daily cron, which retries the oldest first and gives up on a donor after 5 failed attempts. The admin "Send email" button sends one immediately, still within the budget.

### Discord alerts

Create a webhook in a private Discord channel and set `DISCORD_WEBHOOK_URL` (server only). Alerts contain only event names, error codes and donor IDs, never a name, CPR, phone number or email. They are deduplicated: one per kind every 5 minutes, and at most 10 a minute per server instance.

## Cloudflare Turnstile

Create a widget for the production hostname and set `NEXT_PUBLIC_TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY`.

## Vercel

Deploys go through GitHub Actions, not Vercel's Git integration (`vercel.json` turns that off). In the Vercel project:

- Set every variable from `.env.example`, with exactly the same names, for Production. `NEXT_PUBLIC_` values are built into the app, so redeploy after changing them. Use random values of 32 or more characters for `CRON_SECRET` and `RATE_LIMIT_SALT`.
- Add the production domain and set `NEXT_PUBLIC_SITE_URL` to it.

`vercel.json` runs a daily cron at 06:00 UTC that keeps Supabase awake, retries pending emails and clears old technical rows. After the first deploy, run it once from Settings > Cron Jobs and expect a 200; a 401 means `CRON_SECRET` is missing or wrong.

## CI/CD

Two workflows in `.github/workflows/`:

- **`ci.yml`** runs on pull requests and on pushes to other branches: typecheck, lint, tests, the build, the SQL suite and the pgTAP tests. It needs no secrets.
- **`deploy.yml`** runs on every push to `main`, and can also be started by hand. In order: the CI checks, then `supabase db push`, then the Vercel production deploy. If a step fails, nothing after it runs, and two deploys never run at once.

The deploy needs these repository settings. Set them with `gh variable set` and `gh secret set`; the secret commands prompt for the value, so it never lands in your shell history or a file.

| Kind | Name | Where the value comes from |
| --- | --- | --- |
| Variable | `SUPABASE_PROJECT_ID` | The project ref in the Supabase dashboard URL |
| Variable | `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` | `.vercel/project.json` after `vercel link` |
| Secret | `SUPABASE_ACCESS_TOKEN` | Supabase > Account > Access Tokens |
| Secret | `SUPABASE_DB_PASSWORD` | The database password |
| Secret | `VERCEL_TOKEN` | Vercel > Account Settings > Tokens, scoped to the team |

To require approval before each production deploy, add a required reviewer under Settings > Environments > production.

**Rollback:** `vercel rollback`, or promote an older deployment in the Vercel dashboard. Database changes aren't rolled back with it.
