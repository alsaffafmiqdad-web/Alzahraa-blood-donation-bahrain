-- Event start time, and public walk-in signup on the event day (automatic queue number).
alter table public.event add column event_start_time time not null default '08:30';
alter table public.event add column queue_start integer not null default 1
  check (queue_start between 1 and 99999);

-- The ONE place a queue number is issued. Bumping the single event row takes its row lock, so every
-- caller (desk check-in, online walk-in) is serialised and numbers never repeat.
create or replace function public.next_queue_number()
returns integer
language plpgsql security definer set search_path = ''
as $$
declare v_queue integer;
begin
  update public.event set queue_counter = greatest(queue_counter + 1, queue_start)
   where id
   returning queue_counter into v_queue;
  return v_queue;
end $$;
revoke execute on function public.next_queue_number() from public, anon, authenticated;
grant execute on function public.next_queue_number() to service_role;

-- Same body as the init version, except the number now comes from next_queue_number().
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
    v_queue := public.next_queue_number();
  end if;

  update public.donors
     set status = 'waiting', queue_number = v_queue, checked_in_at = coalesce(checked_in_at, now())
   where id = p_donor_id;

  return query select v_queue, false, 'waiting'::text;
end $$;

create or replace function public.register_walk_in_donor(
  p_full_name text, p_cpr text, p_dob date, p_phone text, p_email text, p_blood_type text,
  p_q_recent_donation boolean, p_q_on_medication boolean,
  p_flagged boolean, p_flag_reasons text[]
) returns table (donor_id uuid, queue_number integer)
language plpgsql security definer set search_path = ''
as $$
declare
  v_open boolean;
  v_queue integer;
  v_id uuid;
begin
  select public_registration_open into v_open from public.event where id for update;
  if not coalesce(v_open, false) then raise exception 'registration_closed'; end if;

  v_queue := public.next_queue_number();

  begin
    insert into public.donors (full_name, cpr, dob, phone, email, blood_type, slot_id, source,
      status, queue_number, checked_in_at,
      q_recent_donation, q_on_medication, flagged, flag_reasons, consent, consent_at)
    values (p_full_name, p_cpr, p_dob, p_phone, nullif(p_email, ''), p_blood_type, null, 'walk_in',
      'waiting', v_queue, now(),
      p_q_recent_donation, p_q_on_medication, p_flagged, coalesce(p_flag_reasons, '{}'), true, now())
    returning id into v_id;
  exception when unique_violation then
    raise exception 'duplicate_cpr';
  end;
  return query select v_id, v_queue;
end $$;

revoke execute on function public.register_walk_in_donor(text,text,date,text,text,text,boolean,boolean,boolean,text[]) from public, anon, authenticated;
grant execute on function public.register_walk_in_donor(text,text,date,text,text,text,boolean,boolean,boolean,text[]) to service_role;

-- A public walk-in has no admin uid: show "self signup" as the actor, like an online pre-registration.
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
            case when new.source = 'self_signup' or (new.source = 'walk_in' and v_uid is null) then 'self signup' else v_name end);
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
