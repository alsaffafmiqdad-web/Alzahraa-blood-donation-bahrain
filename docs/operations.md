# Operations

Running the drive: admin accounts, backups, deleting data, and what to check before launch.

## Admin accounts

Any admin can add another in Admin > Settings (email, display name and a temporary password; the new admin should change it after signing in). Removing an admin isn't in the app yet.

The very first admin of a new project has to be created by hand:

1. In Supabase, go to Authentication > Users > Add user, enter the email and a temporary password, and tick Auto Confirm.
2. In the SQL editor, make that user an admin:

   ```sql
   insert into public.admins (user_id, display_name)
   select id, 'Display name' from auth.users where email = 'admin@example.org';
   ```

3. The admin signs in at `/admin/login` and changes the password in Admin > Settings (at least 12 characters).

To remove an admin, delete their row from `public.admins` and then delete the user in Supabase.

## Event day

- Set the event date and start time on Admin > Event before the day. From the start time (Bahrain time) the public link registers walk-ins: no time slot, an automatic queue number and an optional CPR photo.
- Online walk-ins and desk check-ins share one queue sequence. The start number can be changed on Admin > Event; numbers never repeat.
- Desk staff should confirm a walk-in's queue number in the admin list, not from the donor's phone screen.

## Load testing

`pnpm loadtest` runs the real signup path with many users at once (50 by default): the join page, a multipart `POST /api/signup` with a CPR photo, the database function, the Storage upload, the email (production target only) and the donor PDF from `POST /api/card`. It then checks that the data is still correct (one row per CPR, the photo attached, no duplicate or missing queue numbers), reports p50, p95 and p99 latency, throughput, errors by type and email outcomes, prints PASS or FAIL, and removes all of its test data. The rule is a p95 signup latency of 10 seconds or less, and no single signup at 60 seconds or more (the signup route's time limit).

There are two targets. The local target (the default) runs a local `next start` against the local Supabase stack, with email and Discord switched off, in both slot and walk-in mode, and includes the rate limit phase. The production target is for the owner to run by hand: it runs `next start` on your laptop, against the production Supabase and the real Gmail account, in slot mode only. It does not go through Vercel.

All test donors have a CPR starting with `9900` and a name starting with `Loadtest Donor `. Every check and every delete filters on both, so no other row is touched. The test needs internet access, because the signup route calls Cloudflare Turnstile (the script uses Cloudflare's always-passing test secret).

### Local run

1. Start the local stack with `pnpm dlx supabase start`, and put the local URL and keys in `.env.local`.
2. Build the app with `pnpm build`, then run `pnpm loadtest`.
3. Useful flags: `--users <n>` (1 to 500), `--dup <n>` and `--replay <n>` (the duplicate CPR and replay groups), `--image-bytes <n>`, `--mode slot|walk-in|both`, `--skip-rate-limit-check`, `--no-card`, `--keep` and `--p95-budget-ms <n>`. The script lists them when you pass a bad flag.
4. If a run is interrupted, run `pnpm loadtest:cleanup`. A new run refuses to start until the previous one is cleaned up.

The script changes the local event row (the date, start time and whether registration is open) to reach each mode, and restores it at the end. Email and Discord are off in the local run. The signup rate limit (25 per IP per 10 minutes) is not changed; each virtual user sends its own `x-real-ip` header, and phase C shows the limit holds by sending extra requests from one IP and expecting exactly 25 to succeed.

### Production run checklist

1. Run it only when real signups are quiet: not on the event day and not just after a campaign message. The test donors hold `users + 2` real slot places for a few minutes, and the preflight prints how many for each slot.
2. Create `.env.loadtest-production` in the repository root. The `.env*` rule keeps it out of git. Copy in the production Supabase URL and keys, `RATE_LIMIT_SALT`, `CRON_SECRET`, the Gmail settings and the organisation values. Never commit it, and delete it afterwards.
3. The email base is your own Gmail address. The test sends `users + 2` real emails to `<you>+lt-...@gmail.com`, and they count against the 450 a day budget (`--max-emails` caps the run, 80 by default). The preflight shows what is left.
4. Run `pnpm loadtest --target production --env-file .env.loadtest-production --email-base <you@gmail.com>`, then type the Supabase host to confirm.
5. The event row and the queue counter are never changed. The script refuses to run in walk-in mode, when registration is closed, or when the start time is less than 30 minutes away. The rate limit phase and the walk-in phase do not run in production: they would add 25 more real donors, take more slot places and send more real emails, and the local run already proves them because the code and SQL are the same.
6. The script rebuilds `.next` with the production env and deletes `.next/BUILD_ID` when it exits, so a plain `next start` can't serve that build. Run `pnpm build` before using `next start` locally again.
7. Cleanup runs automatically. If the run was interrupted, run `pnpm loadtest:cleanup --target production --env-file .env.loadtest-production`.
8. Check that nothing is left: the final cleanup check prints PASS. In Admin, search for `Loadtest`, which should find nothing, and check that the `cpr-images` bucket has no new folders. The `email_sends` rows stay on purpose, because they keep the daily budget honest, and they have no donor attached.
9. Afterwards, delete the test emails from the Gmail Sent folder and your inbox (their PDFs hold synthetic data only), and delete `.env.loadtest-production`.

### Reading the report

The console shows a table for each phase and step (the page loads, the signups and the card downloads), the result categories, the checks and a final `RESULT` line. `.loadtest/report.json` has the same data without personal details. Categories: `ok`, `duplicate_cpr` (expected in the duplicate group), `rate_limited`, `slot_full`, `validation`, `turnstile` (Cloudflare unreachable), `too_large`, `server`, `timeout` and `network`. A `rate_limited` result is expected only in phase C; anywhere else it means the per-user IP header was not honoured, and it is a FAIL. In production the signup response says `sending`, because the email goes out after the response. The check then waits up to 90 seconds for every test donor's email to be sent or to fail. The report counts the email outcomes (`sent`, `failed` for a Gmail error, and `queued` for not sent within that time: still in flight, or the budget is used up) and checks that each test donor got exactly one email. The verdict is FAIL if any check fails, and the exit code is 0 for PASS, 1 for FAIL and 2 for a configuration, preflight or confirmation error.

### Limits

The test is one Node process on one laptop, while Vercel scales out, so CPU work such as the PDF looks worse than it would in production. The laptop's network path to Supabase and Gmail also differs from Vercel's region, so latencies are a guide, not a promise.

## Backups

The Supabase free plan has no downloadable backups. Once a week during the campaign, export the CSV from Admin > Export CSV and keep it somewhere private. It holds full CPR numbers and screening answers, so handle it with care and delete it when the retention period ends.

## Data retention

The privacy notice promises to delete donor information within 3 months of the event (`RETENTION_MONTHS` in `lib/config.ts`). **Nothing deletes donor data automatically**; the daily cron only clears technical rows such as rate-limit counters and old email records.

When the retention period ends:

1. In the Supabase SQL editor, run `delete from public.donors;`, or delete the whole Supabase project.
2. Empty the `cpr-images` bucket in Supabase > Storage. Deleting donors doesn't remove their photos.
3. Delete every exported CSV and any downloaded or emailed sample PDFs.
4. Delete the confirmation emails in the Gmail account's Sent folder, plus replies and bounces.

## Before launch

- [ ] The blood bank confirms the two screening questions, the age range (`AGE_MIN` and `AGE_MAX` in `lib/config.ts`) and the slot capacities.
- [ ] Data protection (PDPL) review of the consent wording, where the data is stored (the Supabase region, plus the US for Vercel, Google (Gmail) and Resend) and the retention period. Note that the CPR card photo is stored, and that the donor's PDF, sent by download and email, includes their full CPR, flags and notes. Gmail's Sent folder keeps every donor PDF (full CPR, flags, notes).
- [ ] The email account is a dedicated drive Gmail account with 2-Step Verification, accessible to the organisers only (not anyone's personal inbox). The other service accounts (Supabase, Vercel, Resend, Cloudflare) also belong to an organisation email.
- [ ] Vercel Hobby is for non-commercial use; confirm that fits the organiser.
- [ ] A domain is added in Vercel, set as `NEXT_PUBLIC_SITE_URL`, added to the Turnstile widget and verified in Resend.
- [ ] Every variable from `.env.example` is set in Vercel with exactly the same name, and the organisation name and contact details are filled in.
- [ ] "Allow new users to sign up" is off in Supabase Auth.
- [ ] The Thmanyah font licence allows web and PDF embedding.
- [ ] An Arabic speaker has reviewed the Arabic copy and the event details.
- [ ] The daily cron has run successfully (Vercel > Settings > Cron Jobs), and again a day later.
- [ ] Test emails reach real Gmail and Outlook inboxes, and the PDF opens with correct Arabic.
- [ ] A dry run of the event day: walk-in signups, check-in, queue numbers, printing, status changes and the CSV export.
- [ ] The old Apps Script app and its Airtable token are retired, and GitHub Pages is switched off (then remove the root `index.html` redirect).
- [ ] A calendar reminder is set for the data deletion date.
