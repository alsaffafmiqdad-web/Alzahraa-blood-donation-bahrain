-- Idempotent public signup: the browser sends a random submission id with every attempt of one
-- registration, so a retry after a lost response can be recognised (see /api/signup replay).
alter table public.donors add column submission_id uuid unique;

-- Drop and recreate (not create or replace): an extra parameter would otherwise create an overload.
drop function public.register_donor(text,text,date,text,text,text,smallint,boolean,boolean,boolean,text[]);
create function public.register_donor(
  p_full_name text, p_cpr text, p_dob date, p_phone text, p_email text, p_blood_type text,
  p_slot_id smallint,
  p_q_recent_donation boolean, p_q_on_medication boolean,
  p_flagged boolean, p_flag_reasons text[],
  p_submission_id uuid default null
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
      flagged, flag_reasons, consent, consent_at, submission_id)
    values (p_full_name, p_cpr, p_dob, p_phone, nullif(p_email, ''), p_blood_type, p_slot_id, 'self_signup',
      p_q_recent_donation, p_q_on_medication,
      p_flagged, coalesce(p_flag_reasons, '{}'), true, now(), p_submission_id)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'duplicate_cpr';
  end;
  return v_id;
end $$;

revoke execute on function public.register_donor(text,text,date,text,text,text,smallint,boolean,boolean,boolean,text[],uuid) from public, anon, authenticated;
grant execute on function public.register_donor(text,text,date,text,text,text,smallint,boolean,boolean,boolean,text[],uuid) to service_role;

drop function public.register_walk_in_donor(text,text,date,text,text,text,boolean,boolean,boolean,text[]);
create function public.register_walk_in_donor(
  p_full_name text, p_cpr text, p_dob date, p_phone text, p_email text, p_blood_type text,
  p_q_recent_donation boolean, p_q_on_medication boolean,
  p_flagged boolean, p_flag_reasons text[],
  p_submission_id uuid default null
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
      q_recent_donation, q_on_medication, flagged, flag_reasons, consent, consent_at, submission_id)
    values (p_full_name, p_cpr, p_dob, p_phone, nullif(p_email, ''), p_blood_type, null, 'walk_in',
      'waiting', v_queue, now(),
      p_q_recent_donation, p_q_on_medication, p_flagged, coalesce(p_flag_reasons, '{}'), true, now(), p_submission_id)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'duplicate_cpr';
  end;
  return query select v_id, v_queue;
end $$;

revoke execute on function public.register_walk_in_donor(text,text,date,text,text,text,boolean,boolean,boolean,text[],uuid) from public, anon, authenticated;
grant execute on function public.register_walk_in_donor(text,text,date,text,text,text,boolean,boolean,boolean,text[],uuid) to service_role;
