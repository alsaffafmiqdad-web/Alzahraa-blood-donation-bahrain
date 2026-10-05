# Architecture

## Layout

| Path | What's there |
| --- | --- |
| `app/[locale]/` | Public pages in Arabic (`ar`, default, right to left) and English (`en`): signup, success and privacy |
| `app/admin/` | Admin pages and server actions (`actions.ts`) |
| `app/api/` | `signup` (public registration), `card` (PDF download) and `cron/daily` |
| `components/public/`, `components/admin/` | UI; `components/ui/` is shadcn. The admin uses a collapsible left sidebar (an off-canvas drawer on mobile) instead of a top nav |
| `lib/` | Shared logic: validation (Zod), i18n dictionaries, database access (`lib/db/`), email, PDF (`lib/pdf/`), formatting |
| `supabase/migrations/` | The database schema, policies and functions |
| `supabase/sql-tests/`, `supabase/tests/` | SQL and pgTAP tests |
| `tests/` | Vitest unit and route tests |

## Signup flow

0. `/[locale]/join` opens on an intro screen (event name, date, start time, location, and the required documents) with a Register button; the form steps follow, with a sticky Back and Next bar.
1. `/[locale]/join` loads the event and decides on the server whether it's walk-in mode (`lib/event-mode.ts`): on the event date, from the event start time, in Bahrain time.
2. The form posts multipart data to `POST /api/signup`. The server decides the mode again from its own clock and never trusts the client.
3. The route checks the rate limit, validates with Zod, checks the photo's real type from its bytes, verifies Turnstile, and then registers the donor through a database function: `register_donor` for slot signups, or `register_walk_in_donor` for walk-ins, which also issues the next queue number.
4. The CPR photo is uploaded afterwards on a best-effort basis, with a time limit. If it fails, the registration still stands.
5. The browser retries automatically, with backoff, on network errors and 5xx only. Every attempt of one registration carries the same `submissionId` (`donors.submission_id`, unique); if the response was lost, the server replays the original result instead of registering twice. A replay never re-sends the email.
6. Answers and the CPR photo are kept as a draft in `sessionStorage` (this tab only, 2 hours) and restored with Continue; they are cleared on success.
7. The confirmation email and the PDF are sent if the email budget allows; otherwise the daily cron retries.

Queue numbers for walk-ins and desk check-ins come from one function, `next_queue_number()`, under a row lock on the event, so they never clash or repeat.

## Security model

- Row level security is on for every table. Only signed-in users listed in `admins` have policies; the anonymous role has no access.
- Public writes go only through the API routes, which use the service role through database functions. The service role key is read only in `lib/env.ts` and `lib/supabase/admin.ts`, both marked `server-only`.
- Every admin page and server action calls `requireAdmin()`. `proxy.ts` only redirects signed-out visitors for convenience; it is not the security boundary.
- Signup is protected by Turnstile on every request and by a rate limit on salted, hashed IP addresses.
- CPR card photos are in a private storage bucket. Only the server uploads them, and only admins can read or delete them, through short-lived signed URLs.
- No personal data goes in URLs or logs. The admin search turns a typed CPR into its last 4 digits before redirecting, and logs contain only donor IDs.
- Admins see the full CPR in the dashboard, the donor page, the print forms and the CSV.
- The donor's PDF is the same A4 registration form the admins print, including the full CPR, flags and notes (owner decision). After signing up, the donor can download it for 2 hours with a signed token that is kept in `sessionStorage` and sent in a POST body, never in a URL.
- The confirmation email body has no CPR, phone number or screening answers. The PDF is attached.
- Discord alerts (`lib/alert.ts`) carry no personal data: only event names, codes and donor IDs. The browser reports failure codes to `/api/client-log` for the same channel.
- Gmail's Sent folder holds every donor PDF; delete it at the retention date.
- The signup draft holds personal data and the CPR photo in `sessionStorage` until submit.
- Security headers are set in `next.config.ts`.

## Data and limits

- Supabase's API returns at most 1,000 rows per request, so lists and exports read donors in pages (`lib/db/paginate.ts`).
- The email budget is a rolling 24 hours, worked out in the SQL function `email_budget_remaining`.
- The daily cron (`/api/cron/daily`, set up in `vercel.json`) keeps Supabase from pausing, retries emails and clears old technical rows. It doesn't delete donor data; see [operations.md](operations.md).
