# Alzahraa blood donation registration

A small bilingual (Arabic and English) web app for the Alzahraa blood donation drive, sized for about 250 signups. Running cost is $0 apart from a domain.

- Donors pre-register on a public page (`/ar/join`, `/en/join`), pick a 30 minute slot, and get a confirmation email with a PDF donor card.
- Organisers sign in at `/admin` (English only) to see donors, add walk-ins, verify, check in (queue numbers), mark outcomes, print the staff form, manage slots and the event, and export a CSV backup.
- Screening is two questions only: donated in the last 3 months, and taking antibiotics or medication. A "yes" (or an age outside 18-65 on the event date) flags the donor for review. Flags never block registration. Everything else is asked in person by the blood bank team on the day.

Stack: Next.js 16 (App Router, TypeScript), Tailwind CSS 4, shadcn/ui (admin), Supabase (Postgres + Auth), Resend (email), `@react-pdf/renderer` (PDF), Zod, Cloudflare Turnstile, Vercel Hobby, Vitest.

## Local setup

Requirements: Node >= 20.9 (developed on Node 24) and pnpm 11 (`packageManager` is pinned in `package.json`; use `corepack enable` or install pnpm directly).

```bash
pnpm install --frozen-lockfile
cp .env.example .env.local     # then fill it in
pnpm dev                       # http://localhost:3000
pnpm test                      # unit and route tests, all offline
pnpm typecheck && pnpm lint && pnpm build
```

Turnstile test keys for local development (put them in `.env.local`):

- Site key `1x00000000000000000000AA` (always passes) with secret `1x0000000000000000000000000000000AA`.
- Site key `2x00000000000000000000AB` (always blocks) with secret `2x0000000000000000000000000000000AA`.

See "Local development" below for running the admin panel against a local Supabase (Docker). The build needs no environment variables. Without Supabase configured, `/ar/join` shows a "temporarily unavailable" card and `/admin` redirects to the login page.

## Local development (Supabase CLI, for the admin panel)

Everything runs on your machine with Docker and the Supabase CLI (no account, no hosted project, no real email). Use `pnpm dlx supabase@latest ...` or install the CLI.

```bash
pnpm dlx supabase@latest start      # starts Postgres, Auth and the API; prints the local URL and keys
pnpm dlx supabase@latest status -o env   # shows API_URL, ANON_KEY and SERVICE_ROLE_KEY again later
```

1. Put the local values in `.env.local`: `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (the anon or publishable key) and `SUPABASE_SERVICE_ROLE_KEY` (the service_role or secret key), plus the Turnstile test keys above and any random `CRON_SECRET` and `RATE_LIMIT_SALT`.
2. `supabase start` applies `supabase/migrations/` automatically. `supabase db reset` rebuilds the database from the migration and then runs `supabase/seed.sql`, which makes sure an event and the eleven slots exist. **The seed is for local use only**: it never runs on `supabase db push`, and it creates no users.
3. Create a local admin: `pnpm admin:local you@example.org 'a-password-of-12-or-more'` (optional third argument: display name, default is the part of the email before the `@`). It creates the user through the local Auth admin API (already confirmed) and adds them to `public.admins`. It **refuses to run unless `NEXT_PUBLIC_SUPABASE_URL` is `localhost` or `127.0.0.1`**, so it cannot create users in a hosted project. (It reads `.env.local` through `node --env-file-if-exists`, which needs Node 22.9 or newer.)
4. `pnpm dev`, then sign in at http://localhost:3000/admin/login. The local mail inbox and Studio are at http://127.0.0.1:54324 and http://127.0.0.1:54323.
5. `supabase stop` when done (add `--no-backup` to also drop the data).

`supabase/config.toml` is tuned for this project: self sign-up is off, the minimum password is 12 characters (the same rule as `/admin/account`), and realtime, storage, edge functions and analytics are switched off because the app does not use them.

## Supabase project

1. Create the project under the organisation account, region **ap-south-1 (Mumbai)**. There is no GCC region, so this is cross-border storage, and the privacy notice says so. The EU alternative is Frankfurt (eu-central-1), with Vercel region `fra1` instead of `bom1` in `vercel.json`. **The region cannot be changed after the project is created**, so decide it first (see the launch checklist).
2. Copy the project URL, the publishable key (`sb_publishable_...`, or the legacy anon key) and the secret key (`sb_secret_...`, or the legacy service_role key) into the environment variables.
3. Authentication > Providers > Email: **turn off "Allow new users to sign up"**. Admins are created by hand (below).

## Run the migration

GitHub Actions applies new migrations automatically on every merge to `main` (see **CI/CD**). To do it by hand, either link the project and push:

```bash
supabase link --project-ref <ref>
supabase db push
```

or paste `supabase/migrations/20261003000000_init.sql` into the Supabase SQL editor and run it. **If you paste it by hand, record it as applied** (`supabase migration repair --status applied 20261003000000`), otherwise the first CI deploy will try to run it again and fail. The migration creates the tables, row level security policies, the functions (`register_donor`, `check_in_donor`, email budget, rate limit) and seeds the event and the eleven 30 minute slots (08:30 to 13:30, capacity 25 each). Then edit the real event details and slots at `/admin/event` and `/admin/slots`.

The migration also grants the `service_role` explicitly (schema usage, all seven tables, the sequences, and each function the server calls), so nothing depends on the project's "automatically expose new tables" setting. No manual `grant` step is needed.

### Database tests

- **pgTAP** (`supabase/tests/database.test.sql`), via the Supabase CLI: `supabase start && supabase db reset && supabase test db`.
- **Plain Postgres suite** (`supabase/sql-tests/`): the RLS matrix for every table and operation, the history trigger, check-in (including late arrivals and deferred donors), the rate limit and email budget functions, the explicit `service_role` grants, and pgbench concurrency tests (queue numbers, slot capacity, duplicate CPR, email budget, rate limit). Run `bash supabase/sql-tests/run.sh` from the repository root. It needs `psql` and `pgbench` and a local Postgres you can create databases on (the standard `PG*` environment variables apply). It creates a scratch database `alz_sql_test` plus stand-in `anon`, `authenticated` and `service_role` roles and an `auth` schema (`00_setup.sql`), applies the real migration, then drops everything. Do not point it at a database you care about. `supabase test db` does **not** run this suite: it only runs pgTAP files in `supabase/tests/`, and these scripts are plain SQL against a stub of the Supabase roles.

## Adding admins

1. Authentication > Users > Add user > Create new user. Enter the email and a temporary password and tick Auto Confirm.
2. In the SQL editor:

   ```sql
   insert into public.admins (user_id, display_name)
   select id, 'Fatima' from auth.users where email = 'fatima@example.org';
   ```

3. The admin signs in at `/admin/login` and changes the password at `/admin/account` (at least 12 characters).

To remove an admin: `delete from public.admins where user_id = (select id from auth.users where email = '...');` and delete the user. No invite emails are used (Supabase's built-in SMTP only sends to project team members).

## Resend (email)

Add and verify a domain (or a subdomain such as `mail.example.org`) with the SPF and DKIM DNS records, create an API key, and set `RESEND_API_KEY` and `RESEND_FROM_EMAIL`. The free plan allows 100 emails per day and 3,000 per month. The app keeps a rolling 24 hour budget (`EMAIL_DAILY_BUDGET`, default 95). Signup sends immediately if budget remains, otherwise the donor is saved with the email pending. A daily cron retries pending donors, oldest first, and gives up on a donor after 5 failed attempts. The admin "Send email" button ignores the attempt cap but respects the budget. Editing a donor's email address resets that donor's email state (sent flag, attempts, last error), so the corrected address gets the card through the normal retry path (or press "Send email" for an immediate send).

**How the cron paces emails.** The budget is a rolling 24 hours, computed in one place (the SQL function `email_budget_remaining`, also used when claiming a send). Each cron run takes whatever is left of that budget as its cap, sends up to 5 emails at a time, and stops starting new ones after about 4 minutes (`maxDuration` is 300 seconds, the Vercel Hobby maximum with Fluid compute, which is the default for new projects), leaving the rest for the next run.

**Trade-off of a once-a-day cron.** Vercel Hobby only allows a daily cron. Signups send immediately while budget remains, so on launch day the daytime signups use up the budget and the later ones wait for the next run. At 06:00 UTC the cron can only send what the rolling window has freed up (sends from about the same time yesterday have just aged out), so a launch-day backlog drains over a few days rather than in one go. For about 250 signups this is acceptable. To drain faster: press "Send email" on a donor (it also respects the budget), raise `EMAIL_DAILY_BUDGET` if the Resend plan allows it, or add a second trigger (Supabase or an external scheduler calling `/api/cron/daily` with the Bearer secret). If the Resend variables are missing, email is skipped and logged and signup still works.

## Turnstile

Create a Cloudflare Turnstile widget for the production hostname and set `NEXT_PUBLIC_TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY`.

## Vercel

Deploys go through GitHub Actions (see **CI/CD** below), not Vercel's Git integration: `vercel.json` sets `"git": {"deploymentEnabled": false}` and `"framework": "nextjs"`. The app is built on the GitHub runner with the pinned pnpm 11 and uploaded with `vercel deploy --prebuilt`, so Vercel never runs an install and no Corepack setting is needed. In the Vercel dashboard, set every variable from `.env.example` for **Production** (and Preview if you use previews), add the production domain under Project Settings > Domains and set `NEXT_PUBLIC_SITE_URL` to it. `vercel.json` sets the function region to `bom1` (Mumbai, next to the database) and a daily cron at 06:00 UTC (09:00 Bahrain) that keeps Supabase awake, retries pending emails and cleans up old rate limit and email rows. Vercel sends `Authorization: Bearer $CRON_SECRET` automatically when `CRON_SECRET` is set.

**Check that the cron ran.** After the first deploy open Vercel > your project > Settings > Cron Jobs (or Logs, filter by `/api/cron/daily`). Use "Run" once and expect a 200 with `{"ok":true,...}`. A 401 means `CRON_SECRET` is missing or wrong. The cron also keeps the Supabase project from pausing after 7 days of inactivity, so check it again a day after launch.

## CI/CD

Two workflows in `.github/workflows/`:

- **`ci.yml`** runs on every pull request and on pushes to other branches. It runs typecheck, lint, the vitest suite and `next build`, the plain Postgres SQL suite, and the migration plus pgTAP on Supabase's own Postgres image (`supabase db start && supabase test db`). It needs no secrets, so it also runs on PRs from forks.
- **`deploy.yml`** runs on every push to `main` (merging a PR) and can be started by hand (Actions > Deploy > Run workflow). In order: all CI checks, then `supabase db push` to the production project, then `vercel build --prod` and `vercel deploy --prebuilt --prod`. If a step fails, nothing after it runs, so a failed migration never ships new code. Two deploys never run at the same time.

The deploy jobs use the GitHub environment `production` (created on the first run). To require a manual approval before each production deploy, add yourself as a required reviewer under Settings > Environments > production.

Rollback: `vercel rollback` (or Promote an older deployment in the Vercel dashboard) restores the previous app instantly. Database migrations are not rolled back automatically: write a new forward migration instead.

## Weekly backup

Supabase Free has no downloadable backups. Every week an organiser should open Admin > Export CSV and store the file somewhere private. The CSV contains full CPR numbers and health answers: handle it accordingly and delete it after the retention period.

## Security notes

- Row level security is on for all 7 tables. The only policies are for `authenticated` users who are in `admins`. The anon role has no grants.
- Public signup goes only through `POST /api/signup`, which uses the service role via the `register_donor` function. It first checks (read only) whether the salted, hashed IP is already over the rate limit (25 per 10 minutes), then validates with Zod, then verifies Turnstile, and only then counts the attempt and writes. Typos and failed Turnstile checks therefore never use up the quota, which matters because many phones share one carrier (CGNAT) IP and the link spreads in WhatsApp groups. Turnstile is the main bot defence. The flags are computed on the server.
- The service role key is read only in `lib/env.ts` and `lib/supabase/admin.ts`, behind `server-only`.
- Every admin page and action calls `requireAdmin()`. `proxy.ts` only redirects signed-out visitors as a convenience.
- The dashboard search form is a POST (a Server Action); a full CPR typed into it is reduced to its last 4 digits before redirecting, so a CPR never lands in the URL, browser history or Vercel request logs.
- The full CPR is shown only to signed-in admins: the dashboard list, the donor detail page, the print forms and the CSV (staff need it at the desk). The email and the donor card PDF never contain it.
- After signing up, the donor can download their own card from the success page. `/api/signup` returns a signed token (HMAC-SHA256, key derived from `RATE_LIMIT_SALT`, valid for 2 hours) that the page keeps in `sessionStorage` for that tab only and sends in a POST body to `/api/card`, so it never appears in a URL or request log. A missing, altered or expired token gets a 403, and the card has no CPR.
- Security headers are set in `next.config.ts` (frame-ancestors, nosniff, referrer policy, permissions policy). A strict `script-src` CSP is not set: Next injects inline scripts, so it would need per-request nonces, which is out of scope here.
- The dashboard, the print pages, the slots page and the CSV export read donors in pages of 1000 (`.range()` loops), because PostgREST silently caps a response at 1000 rows.
- The rate limit fails open if the database call errors. Turnstile is still enforced in that case.

## Data retention

The privacy notice promises: "We delete your information within 3 months after the event" (`RETENTION_MONTHS = 3` in `lib/config.ts` fills in the number, in Arabic and English). **Nothing deletes donor data automatically.** The daily cron's maintenance step (`daily_maintenance`) only clears technical rows: rate limit counters older than 1 day and email send records older than 7 days. Donor rows, the status history and any CSV exports stay until you delete them, so the deletion is a manual, dated task (see the checklist). If you change the event date or `RETENTION_MONTHS`, recompute the date.

To delete: in the Supabase SQL editor run `delete from public.donors;` (the status history is removed with it; email records are detached), or delete the Supabase project. Also delete every exported CSV and any sample donor card PDFs.

## Before launch

Tick each box and keep the date you did it.

- [ ] **Blood bank confirmation:** the blood bank confirms the 2 screening questions and their periods (donated in the last 3 months; antibiotics or medication), the 18-65 age range (`AGE_MIN`, `AGE_MAX` in `lib/config.ts`), and the slot capacity (25 donors per 30 minutes, editable at `/admin/slots`). Change the code or the slots if they differ.
- [ ] **Supabase region decided and recorded** (Mumbai `ap-south-1` with Vercel `bom1`, or Frankfurt `eu-central-1` with `fra1`), together with the PDPL review. The region cannot be changed after the project is created.
- [ ] Create the Supabase, Vercel, Resend and Cloudflare accounts under an **organisation email**, not a personal one.
- [ ] Hosting terms: Vercel Hobby is for non-commercial use. If the organiser is not a charity or non-commercial, use Cloudflare or Netlify.
- [ ] **PDPL legal check:** the consent wording, cross-border storage (India or Germany for the database, the US for Vercel and Resend), and the retention period (`RETENTION_MONTHS = 3`, shown in the privacy notice).
- [ ] **Domain:** buy one or use an organisation subdomain. Add it to the Vercel project (Settings > Domains), set `NEXT_PUBLIC_SITE_URL` to it, add its hostname to the Cloudflare Turnstile widget, and verify the sending domain in Resend (SPF and DKIM).
- [ ] Vercel environment: every variable from `.env.example`, `CRON_SECRET` and `RATE_LIMIT_SALT` random (32+ characters), the organisation name, contact email and phone variables filled in (they appear in the privacy notice, the email and the PDF), (no Corepack setting is needed: CI builds with the pinned pnpm and deploys prebuilt).
- [ ] Supabase Auth: "Allow new users to sign up" is **off**. Admins are added by hand.
- [ ] Have an Arabic speaker review the Arabic copy, the English event name and the seed values in the migration.
- [ ] **Verify the cron ran** after the first deploy: Vercel > Settings > Cron Jobs > Run, or Logs filtered by `/api/cron/daily`; expect 200 (401 means `CRON_SECRET` is missing). Check again a day later. If it silently stops, Supabase pauses the project after 7 days.
- [ ] **Export the Airtable base to CSV as an archive, then retire the old Apps Script deployment (required).** There is no data migration: the new app starts fresh. The old app's Apps Script URL and staff secret remain in the git history on `main`, so anyone with repository access can still find them: switch the deployment off (Apps Script > Deploy > Manage deployments > archive it) and rotate or delete the staff secret.
- [ ] Test with real Gmail and Outlook inboxes (spam folder, PDF rendering, Arabic).
- [ ] Launch pacing: signups send an email immediately while budget remains (95 per rolling 24 hours). More than that in a day waits for the daily cron, which sends only what the window has freed up, so a large backlog takes several days to clear. Use the admin "Send email" button for urgent ones and watch "Emails pending" on the dashboard.
- [ ] Do a dry run of the event day: verify, check in, queue numbers, printing, status changes including a **late arrival marked no show** (it can still be checked in), and the CSV export. A deferred donor is deliberately not checked in directly: staff change the status first.
- [ ] Look at a sample donor card PDF with real Arabic names. If Arabic ever renders joined wrongly on your viewer, set `PDF_ARABIC_ENABLED = false` in `lib/config.ts` (English block only; Arabic stays in the email).
- [ ] During the campaign: export the CSV weekly to private storage.
- [ ] **After the event + 3 months (16 January 2027 for an event on 16 October 2026): delete the donor data** (`delete from public.donors;` or delete the Supabase project) **and every exported CSV**, as the privacy notice promises. Put a reminder in a calendar now.
