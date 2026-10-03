\set ON_ERROR_STOP on
-- status history: written only by the trigger, with correct actor
do $$
declare did uuid; n int; rec record;
begin
  -- admin inserts a donor: 'created' row by admin name
  perform set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-4000-8000-000000000001', true);
  set local role authenticated;
  insert into public.donors (full_name, cpr, source, slot_id, consent) values ('Hist One', '555555555', 'walk_in', 1, true) returning id into did;
  update public.donors set status = 'donated' where id = did;               -- status row
  update public.donors set notes = 'edited' where id = did;                  -- edit row
  update public.donors set flagged = true where id = did;                    -- no row (not a tracked column)
  select count(*) into n from public.donor_status_history where donor_id = did;
  reset role;
  perform t.chk('history row count (created,status,edit)', n::text, '3');
  for rec in select kind, from_status, to_status, changed_by, changed_by_name from public.donor_status_history where donor_id = did order by id loop
    null;
  end loop;
  perform t.chk('created row names the admin', (select changed_by_name from public.donor_status_history where donor_id=did and kind='created'), 'Admin A');
  perform t.chk('status row from/to', (select from_status||'>'||to_status from public.donor_status_history where donor_id=did and kind='status'), 'registered>donated');
  perform t.chk('actor uid recorded', (select changed_by::text from public.donor_status_history where donor_id=did and kind='status'), 'aaaaaaaa-0000-4000-8000-000000000001');

  -- self-signup via service role: 'self signup', no uid
  perform set_config('request.jwt.claim.sub', '', true);
  set local role service_role;
  perform public.register_donor('Public P','666666666','1990-01-01','33334444',null,'unknown',2::smallint,false,false,false,'{}');
  reset role;
  perform t.chk('self signup history actor', (select changed_by_name from public.donor_status_history h join public.donors d on d.id=h.donor_id where d.cpr='666666666' and kind='created'), 'self signup');

  -- history insert can't be forged by admin; only trigger writes
  perform t.chk('admin forging history insert', t.attempt('authenticated','aaaaaaaa-0000-4000-8000-000000000001',
    $q$insert into public.donor_status_history (donor_id,kind,to_status,changed_by_name) select id,'status','donated','forged' from public.donors limit 1$q$), 'denied');
  -- history cascades on donor delete (admin)
  perform set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-4000-8000-000000000001', true);
  set local role authenticated;
  delete from public.donors where id = did;
  reset role;
  perform t.chk('history cascades with donor delete', (select count(*)::text from public.donor_status_history where donor_id = did), '0');
  -- triggers' functions are not callable directly
  perform t.chk('anon cannot call log_donor_change', t.attempt('anon', null, 'select public.log_donor_change()'), 'denied');
  perform t.chk('authed cannot call log_donor_change', t.attempt('authenticated','aaaaaaaa-0000-4000-8000-000000000001', 'select public.log_donor_change()'), 'denied');
end $$;

-- check-in: single donor sequence + history rows (verified then waiting)
do $$
declare did uuid; r record;
begin
  select id into did from public.donors where cpr = '666666666';
  perform set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-4000-8000-000000000001', true);
  set local role authenticated;
  select * into r from public.check_in_donor(did);
  reset role;
  perform t.chk('check-in returns queue 1', r.queue_number::text || '/' || r.already_checked_in::text || '/' || r.status, '1/false/waiting');
  perform t.chk('check-in history rows', (select string_agg(to_status, ',' order by id) from public.donor_status_history where donor_id = did and kind='status'), 'verified,waiting');
  set local role authenticated;
  select * into r from public.check_in_donor(did);
  reset role;
  perform t.chk('repeat check-in idempotent', r.queue_number::text || '/' || r.already_checked_in::text, '1/true');
  perform t.chk('counter not bumped by repeat', (select queue_counter::text from public.event), '1');
end $$;

select 'FAIL' r, name, detail from t.results where not ok;
select count(*) filter (where ok) as passed, count(*) filter (where not ok) as failed from t.results;
