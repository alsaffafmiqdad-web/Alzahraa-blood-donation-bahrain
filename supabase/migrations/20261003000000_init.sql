-- Extensions
create extension if not exists pgcrypto;

-- ============ Tables ============
create table public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 60),
  created_at timestamptz not null default now()
);

create table public.event (
  id boolean primary key default true check (id),           -- single row
  name_ar text not null check (char_length(name_ar) between 1 and 200),
  name_en text not null check (char_length(name_en) between 1 and 200),
  location_ar text not null default '' check (char_length(location_ar) <= 200),
  location_en text not null default '' check (char_length(location_en) <= 200),
  event_date date not null,
  public_registration_open boolean not null default true,
  queue_counter integer not null default 0 check (queue_counter >= 0),
  updated_at timestamptz not null default now()
);

create table public.slots (
  id smallint generated always as identity primary key,
  starts_at time not null unique,
  capacity integer not null check (capacity between 1 and 500),
  active boolean not null default true
);

create table public.donors (
  id uuid primary key default gen_random_uuid(),
  full_name text not null check (char_length(full_name) between 1 and 150),
  cpr text not null unique check (cpr ~ '^[0-9]{9}$'),
  phone text check (phone is null or phone ~ '^[0-9]{8}$'),
  email text check (email is null or char_length(email) between 3 and 254),
  dob date,
  blood_type text not null default 'unknown'
    check (blood_type in ('unknown','A+','A-','B+','B-','AB+','AB-','O+','O-')),
  slot_id smallint references public.slots(id) on delete restrict,
  source text not null check (source in ('self_signup','admin_added','walk_in')),
  status text not null default 'registered'
    check (status in ('registered','verified','waiting','screening','donated','deferred','no_show')),
  queue_number integer unique check (queue_number is null or queue_number > 0),
  checked_in_at timestamptz,
  q_recent_donation boolean,
  q_on_medication boolean,
  flagged boolean not null default false,
  flag_reasons text[] not null default '{}',
  notes text check (notes is null or char_length(notes) <= 1000),
  consent boolean not null check (consent),
  consent_at timestamptz not null default now(),
  email_sent boolean not null default false,
  email_attempts integer not null default 0,
  email_last_error text,
  email_last_attempt_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint self_signup_has_slot check (source <> 'self_signup' or slot_id is not null)
);
create index donors_email_lower_idx on public.donors (lower(email));
create index donors_slot_idx on public.donors (slot_id);
create index donors_email_retry_idx on public.donors (created_at)
  where email_sent = false and email is not null;

create table public.donor_status_history (
  id bigint generated always as identity primary key,
  donor_id uuid not null references public.donors(id) on delete cascade,
  kind text not null check (kind in ('created','status','edit')),
  from_status text,
  to_status text not null,
  changed_by uuid references auth.users(id) on delete set null,
  changed_by_name text not null,
  changed_at timestamptz not null default now()
);
create index donor_status_history_donor_idx on public.donor_status_history (donor_id, changed_at);

create table public.email_sends (
  id bigint generated always as identity primary key,
  donor_id uuid references public.donors(id) on delete set null,
  status text not null check (status in ('claimed','sent','failed')),
  created_at timestamptz not null default now()
);
create index email_sends_created_idx on public.email_sends (created_at);

create table public.rate_limits (
  key text not null,
  window_start timestamptz not null,
  hits integer not null default 0,
  primary key (key, window_start)
);

-- ============ Helpers ============
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.admins where user_id = auth.uid()) $$;

create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = ''
as $$ begin new.updated_at := now(); return new; end $$;

create trigger donors_touch before update on public.donors
  for each row execute function public.touch_updated_at();
create trigger event_touch before update on public.event
  for each row execute function public.touch_updated_at();

-- History: who and when, written only by this trigger
create or replace function public.log_donor_change()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_name text;
begin
  select display_name into v_name from public.admins where user_id = v_uid;
  v_name := coalesce(v_name, case when v_uid is null then 'system' else 'unknown' end);
  if tg_op = 'INSERT' then
    insert into public.donor_status_history (donor_id, kind, from_status, to_status, changed_by, changed_by_name)
    values (new.id, 'created', null, new.status, v_uid,
            case when new.source = 'self_signup' then 'self signup' else v_name end);
  elsif new.status is distinct from old.status then
    insert into public.donor_status_history (donor_id, kind, from_status, to_status, changed_by, changed_by_name)
    values (new.id, 'status', old.status, new.status, v_uid, v_name);
  elsif (new.full_name, new.cpr, new.phone, new.email, new.dob, new.blood_type, new.slot_id, new.notes,
         new.q_recent_donation, new.q_on_medication)
        is distinct from
        (old.full_name, old.cpr, old.phone, old.email, old.dob, old.blood_type, old.slot_id, old.notes,
         old.q_recent_donation, old.q_on_medication) then
    insert into public.donor_status_history (donor_id, kind, from_status, to_status, changed_by, changed_by_name)
    values (new.id, 'edit', old.status, new.status, v_uid, v_name);
  end if;
  return new;
end $$;

create trigger donors_history after insert or update on public.donors
  for each row execute function public.log_donor_change();

-- ============ Public signup (service role only) ============
create or replace function public.register_donor(
  p_full_name text, p_cpr text, p_dob date, p_phone text, p_email text, p_blood_type text,
  p_slot_id smallint,
  p_q_recent_donation boolean, p_q_on_medication boolean,
  p_flagged boolean, p_flag_reasons text[]
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_open boolean;
  v_cap integer;
  v_active boolean;
  v_count integer;
  v_id uuid;
begin
  select public_registration_open into v_open from public.event where id;
  if not coalesce(v_open, false) then raise exception 'registration_closed'; end if;

  select capacity, active into v_cap, v_active from public.slots where id = p_slot_id for update;
  if v_cap is null or not v_active then raise exception 'slot_unavailable'; end if;

  select count(*) into v_count from public.donors where slot_id = p_slot_id;
  if v_count >= v_cap then raise exception 'slot_full'; end if;

  begin
    insert into public.donors (full_name, cpr, dob, phone, email, blood_type, slot_id, source,
      q_recent_donation, q_on_medication,
      flagged, flag_reasons, consent, consent_at)
    values (p_full_name, p_cpr, p_dob, p_phone, nullif(p_email, ''), p_blood_type, p_slot_id, 'self_signup',
      p_q_recent_donation, p_q_on_medication,
      p_flagged, coalesce(p_flag_reasons, '{}'), true, now())
    returning id into v_id;
  exception when unique_violation then
    raise exception 'duplicate_cpr';
  end;
  return v_id;
end $$;

-- Public slot availability (service role only; called by the /join server component)
create or replace function public.slot_availability()
returns table (id smallint, starts_at time, capacity integer, booked integer)
language sql stable security definer set search_path = ''
as $$
  select s.id, s.starts_at, s.capacity, (select count(*)::int from public.donors d where d.slot_id = s.id)
  from public.slots s where s.active order by s.starts_at
$$;

-- ============ Check-in: atomic queue number (admins) ============
create or replace function public.check_in_donor(p_donor_id uuid)
returns table (queue_number integer, already_checked_in boolean, status text)
language plpgsql security definer set search_path = ''
as $$
declare
  v_status text;
  v_queue integer;
begin
  if not public.is_admin() then raise exception 'not_authorized'; end if;

  select d.status, d.queue_number into v_status, v_queue
    from public.donors d where d.id = p_donor_id for update;
  if v_status is null then raise exception 'not_found'; end if;

  -- Statuses that can be checked in: registered, verified, and no_show (a late arrival).
  -- 'deferred' is deliberately refused: it is a blood bank decision, so staff must change the
  -- status explicitly first. waiting/screening/donated are already in or past the queue.
  -- Refused cases return already_checked_in = true with the current status (queue_number may be null).
  if v_status not in ('registered','verified','no_show') then
    return query select v_queue, true, v_status;
    return;
  end if;

  if v_status = 'registered' then
    update public.donors set status = 'verified' where id = p_donor_id;   -- logged as its own history row
  end if;

  if v_queue is null then
    update public.event set queue_counter = queue_counter + 1 where id returning queue_counter into v_queue;
  end if;

  update public.donors
     set status = 'waiting', queue_number = v_queue, checked_in_at = coalesce(checked_in_at, now())
   where id = p_donor_id;

  return query select v_queue, false, 'waiting'::text;
end $$;

-- ============ Email budget (service role only) ============
-- The ONE place the rolling 24h budget is computed. claim_email_send and the cron's per-run cap both use it.
create or replace function public.email_budget_remaining(p_budget integer)
returns integer
language sql stable security definer set search_path = ''
as $$
  select greatest(p_budget - count(*)::int, 0) from public.email_sends
   where status in ('claimed','sent') and created_at > now() - interval '24 hours'
$$;

create or replace function public.claim_email_send(p_donor_id uuid, p_budget integer)
returns bigint
language plpgsql security definer set search_path = ''
as $$
declare
  v_id bigint;
begin
  perform pg_advisory_xact_lock(hashtext('email_budget'));
  if public.email_budget_remaining(p_budget) <= 0 then return null; end if;
  insert into public.email_sends (donor_id, status) values (p_donor_id, 'claimed') returning id into v_id;
  return v_id;
end $$;

create or replace function public.finish_email_send(p_claim_id bigint, p_success boolean, p_error text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare v_donor uuid;
begin
  update public.email_sends set status = case when p_success then 'sent' else 'failed' end
   where id = p_claim_id returning donor_id into v_donor;
  if v_donor is not null then
    update public.donors
       set email_sent = p_success or email_sent,
           email_attempts = email_attempts + 1,
           email_last_error = case when p_success then null else left(p_error, 500) end,
           email_last_attempt_at = now()
     where id = v_donor;
  end if;
end $$;

-- ============ Rate limit (service role only) ============
create or replace function public.rate_limit_hit(p_key text, p_limit integer, p_window_seconds integer)
returns boolean   -- true = allowed
language plpgsql security definer set search_path = ''
as $$
declare
  v_window timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  v_hits integer;
begin
  insert into public.rate_limits (key, window_start, hits) values (p_key, v_window, 1)
  on conflict (key, window_start) do update set hits = public.rate_limits.hits + 1
  returning hits into v_hits;
  return v_hits <= p_limit;
end $$;

-- Read-only companion: true = still under the limit (does not count a hit).
-- The signup route peeks first, then counts a hit only after Zod and Turnstile have passed.
create or replace function public.rate_limit_peek(p_key text, p_limit integer, p_window_seconds integer)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce((select hits from public.rate_limits
    where key = p_key
      and window_start = to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds)), 0) < p_limit
$$;

create or replace function public.daily_maintenance()
returns void language sql security definer set search_path = ''
as $$
  delete from public.rate_limits where window_start < now() - interval '1 day';
  delete from public.email_sends where created_at < now() - interval '7 days';
$$;

-- ============ RLS ============
alter table public.admins enable row level security;
alter table public.event enable row level security;
alter table public.slots enable row level security;
alter table public.donors enable row level security;
alter table public.donor_status_history enable row level security;
alter table public.email_sends enable row level security;
alter table public.rate_limits enable row level security;

create policy "admins read own row" on public.admins for select to authenticated
  using (user_id = (select auth.uid()));

create policy "admins read event" on public.event for select to authenticated using ((select public.is_admin()));
create policy "admins update event" on public.event for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

create policy "admins read slots" on public.slots for select to authenticated using ((select public.is_admin()));
create policy "admins insert slots" on public.slots for insert to authenticated with check ((select public.is_admin()));
create policy "admins update slots" on public.slots for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "admins delete slots" on public.slots for delete to authenticated using ((select public.is_admin()));

create policy "admins read donors" on public.donors for select to authenticated using ((select public.is_admin()));
create policy "admins insert donors" on public.donors for insert to authenticated with check ((select public.is_admin()));
create policy "admins update donors" on public.donors for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "admins delete donors" on public.donors for delete to authenticated using ((select public.is_admin()));

create policy "admins read history" on public.donor_status_history for select to authenticated
  using ((select public.is_admin()));
-- email_sends, rate_limits: no policies (service role only). History: no write policies (trigger only).

-- ============ Grants ============
revoke all on all tables in schema public from anon;
revoke all on all tables in schema public from authenticated;
grant select on public.admins to authenticated;
grant select, update on public.event to authenticated;
grant select, insert, update, delete on public.slots, public.donors to authenticated;
grant select on public.donor_status_history to authenticated;

-- The server (service_role) is granted explicitly, so the app does not depend on Supabase's
-- "automatically expose new tables" setting. Harmless if the grants already exist.
grant usage on schema public to service_role;
grant select, insert, update, delete on
  public.admins, public.event, public.slots, public.donors,
  public.donor_status_history, public.email_sends, public.rate_limits
  to service_role;
grant usage, select on all sequences in schema public to service_role;

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.check_in_donor(uuid) to authenticated;
grant execute on function public.register_donor(text,text,date,text,text,text,smallint,boolean,boolean,boolean,text[]) to service_role;
grant execute on function public.slot_availability() to service_role;
grant execute on function public.claim_email_send(uuid,integer) to service_role;
grant execute on function public.finish_email_send(bigint,boolean,text) to service_role;
grant execute on function public.rate_limit_hit(text,integer,integer) to service_role;
grant execute on function public.rate_limit_peek(text,integer,integer) to service_role;
grant execute on function public.email_budget_remaining(integer) to service_role;
grant execute on function public.daily_maintenance() to service_role;

-- ============ Seed ============
insert into public.event (name_ar, name_en, location_ar, location_en, event_date) values (
  'حملة عطاء الزهراء ال 9 للتبرع بالدم',
  'Alzahraa Ataa 9th Blood Donation Campaign',
  'حملة التبرع بالدم للرجال، صالة فاطمة كانو، توبلي',
  'Men''s blood donation drive, Fatima Kanoo Hall, Tubli',
  '2026-10-16');

insert into public.slots (starts_at, capacity)
select t::time, 25
from generate_series('2026-01-01 08:30'::timestamp, '2026-01-01 13:30'::timestamp, interval '30 minutes') as t;
