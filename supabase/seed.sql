-- LOCAL DEVELOPMENT ONLY. Loaded by `supabase db reset` (see [db.seed] in config.toml).
-- It is never run by `supabase db push` and never touches a hosted project.
-- It creates NO users: use `pnpm admin:local <email> <password>` for a local admin.
--
-- The init migration already inserts the real event and slots (they ship to production, where the
-- owner then edits them in /admin). This file only guarantees local data exists, and is idempotent
-- so it never duplicates what the migration created.

insert into public.event (name_ar, name_en, location_ar, location_en, event_date)
select 'حملة تجريبية محلية', 'Local test campaign', 'موقع تجريبي', 'Local test venue',
       (current_date + 14)
where not exists (select 1 from public.event);

insert into public.slots (starts_at, capacity)
select t::time, 25
from generate_series('2026-01-01 08:30'::timestamp, '2026-01-01 13:30'::timestamp, interval '30 minutes') as t
where not exists (select 1 from public.slots);
