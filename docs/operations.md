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
