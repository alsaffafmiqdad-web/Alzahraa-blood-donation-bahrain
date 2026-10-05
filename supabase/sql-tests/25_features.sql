\set ON_ERROR_STOP on
-- Fix round 2: late arrivals, deferred, rate_limit_peek, email_budget_remaining, explicit service_role grants.
do $$
declare did uuid; r record; n0 int;
begin
  perform set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-4000-8000-000000000001', true);
  select queue_counter into n0 from public.event;

  -- no_show late arrival: can be checked in, gets the next queue number, history shows no_show > waiting
  set local role authenticated;
  insert into public.donors (full_name, cpr, source, slot_id, consent, status) values ('Late One', '777000001', 'self_signup', 1, true, 'no_show') returning id into did;
  select * into r from public.check_in_donor(did);
  reset role;
  perform t.chk('no_show check-in succeeds', r.already_checked_in::text || '/' || r.status, 'false/waiting');
  perform t.chk('no_show check-in takes the next number', r.queue_number::text, (n0 + 1)::text);
  perform t.chk('no_show history from>to', (select string_agg(from_status || '>' || to_status, ',' order by id) from public.donor_status_history where donor_id = did and kind = 'status'), 'no_show>waiting');
  perform t.chk('no_show check-in stamps checked_in_at', (select (checked_in_at is not null)::text from public.donors where id = did), 'true');

  -- repeat is idempotent
  set local role authenticated;
  select * into r from public.check_in_donor(did);
  reset role;
  perform t.chk('late arrival repeat check-in idempotent', r.queue_number::text || '/' || r.already_checked_in::text, (n0 + 1)::text || '/true');

  -- deferred is refused (blood bank decision), no queue number, counter unchanged, status unchanged
  set local role authenticated;
  insert into public.donors (full_name, cpr, source, slot_id, consent, status) values ('Deferred One', '777000002', 'walk_in', 1, true, 'deferred') returning id into did;
  select * into r from public.check_in_donor(did);
  reset role;
  perform t.chk('deferred refused', coalesce(r.queue_number::text, 'null') || '/' || r.already_checked_in::text || '/' || r.status, 'null/true/deferred');
  perform t.chk('deferred still deferred', (select status from public.donors where id = did), 'deferred');
  perform t.chk('counter untouched by refusals', (select queue_counter::text from public.event), (n0 + 1)::text);

  -- screening / donated are past the queue: refused with their own status
  set local role authenticated;
  insert into public.donors (full_name, cpr, source, slot_id, consent, status) values ('Done One', '777000003', 'walk_in', 1, true, 'donated') returning id into did;
  select * into r from public.check_in_donor(did);
  reset role;
  perform t.chk('donated refused', r.already_checked_in::text || '/' || r.status, 'true/donated');

  -- non admin still cannot
  perform t.chk('non-admin check-in of no_show still denied',
    t.attempt('authenticated', 'bbbbbbbb-0000-4000-8000-000000000002',
      $q$select * from public.check_in_donor((select id from public.donors where cpr = '777000001'))$q$), 'error:P0001');
end $$;

-- rate_limit_peek: read only, same window and key arithmetic as rate_limit_hit
do $$
begin
  perform t.chk('peek on a fresh key is allowed', t.attempt('service_role', null, $q$select public.rate_limit_peek('pk', 2, 600)$q$), 'rows=1');
  perform t.chk('peek does not create a row', (select count(*)::text from public.rate_limits where key = 'pk'), '0');
  set local role service_role;
  perform public.rate_limit_hit('pk', 2, 600);
  perform public.rate_limit_hit('pk', 2, 600);
  perform t.chk('peek true while hits are below the limit', public.rate_limit_peek('pk', 3, 600)::text, 'true');
  perform t.chk('peek false once hits reach the limit', public.rate_limit_peek('pk', 2, 600)::text, 'false');
  perform t.chk('peek leaves the counter alone', (select hits::text from public.rate_limits where key = 'pk'), '2');
  perform t.chk('peek of another key unaffected', public.rate_limit_peek('other', 2, 600)::text, 'true');
  reset role;
  perform t.chk('anon rate_limit_peek', t.attempt('anon', null, $q$select public.rate_limit_peek('a',5,60)$q$), 'denied');
  perform t.chk('authed rate_limit_peek', t.attempt('authenticated', 'aaaaaaaa-0000-4000-8000-000000000001', $q$select public.rate_limit_peek('a',5,60)$q$), 'denied');
end $$;

-- email_budget_remaining: the single place for the rolling 24h arithmetic
do $$
declare c1 bigint; c2 bigint;
begin
  delete from public.email_sends;
  set local role service_role;
  perform t.chk('remaining on empty budget', public.email_budget_remaining(10)::text, '10');
  c1 := public.claim_email_send(null, 10);
  c2 := public.claim_email_send(null, 10);
  perform t.chk('remaining after 2 claims', public.email_budget_remaining(10)::text, '8');
  perform public.finish_email_send(c1, true, null);
  perform t.chk('sent still counts', public.email_budget_remaining(10)::text, '8');
  perform public.finish_email_send(c2, false, 'boom');
  perform t.chk('failed does not count', public.email_budget_remaining(10)::text, '9');
  perform t.chk('remaining never negative', public.email_budget_remaining(0)::text, '0');
  reset role;
  insert into public.email_sends (status, created_at) values ('sent', now() - interval '25 hours');
  set local role service_role;
  perform t.chk('sends older than 24h do not count', public.email_budget_remaining(10)::text, '9');
  perform t.chk('claim refused when none remain', coalesce(public.claim_email_send(null, 1)::text, 'null'), 'null');
  reset role;
  perform t.chk('anon email_budget_remaining', t.attempt('anon', null, $q$select public.email_budget_remaining(5)$q$), 'denied');
  perform t.chk('authed email_budget_remaining', t.attempt('authenticated', 'aaaaaaaa-0000-4000-8000-000000000001', $q$select public.email_budget_remaining(5)$q$), 'denied');
end $$;

-- explicit service_role grants (default privileges for service_role are OFF in this harness)
do $$
declare tbl text;
begin
  foreach tbl in array array['admins','event','slots','donors','donor_status_history','email_sends','rate_limits'] loop
    perform t.chk('service_role select ' || tbl, (t.attempt('service_role', null, 'select * from public.' || tbl) <> 'denied')::text, 'true');
  end loop;
  perform t.chk('service_role can insert into a table with an identity sequence',
    t.attempt('service_role', null, $q$insert into public.slots (starts_at, capacity) values ('22:00', 5)$q$), 'rows=1');
  perform t.chk('service_role can update event', t.attempt('service_role', null, $q$update public.event set updated_at = now()$q$), 'rows=1');
  perform t.chk('anon still has no direct table access', t.attempt('anon', null, 'select * from public.donors'), 'denied');
end $$;

-- public walk-in signup: automatic queue number from the same counter as desk check-in
do $$
declare n0 integer; r record; did uuid; ci record; adm constant text := 'aaaaaaaa-0000-4000-8000-000000000001';
begin
  select queue_counter into n0 from public.event;
  perform set_config('request.jwt.claim.sub', '', true);
  set local role service_role;
  select * into r from public.register_walk_in_donor('Walk P','777000010','1990-01-01','33335555',null,'unknown',false,false,false,'{}');
  reset role;
  did := r.donor_id;
  perform t.chk('walk-in returns next queue number', r.queue_number::text, (n0 + 1)::text);
  perform t.chk('walk-in bumps the counter', (select queue_counter::text from public.event), (n0 + 1)::text);
  perform t.chk('walk-in row state',
    (select source || '/' || (slot_id is null)::text || '/' || status || '/' || queue_number::text || '/' || (checked_in_at is not null)::text
       from public.donors where id = did),
    'walk_in/true/waiting/' || (n0 + 1)::text || '/true');
  perform t.chk('walk-in created history actor and status',
    (select changed_by_name || '/' || to_status from public.donor_status_history where donor_id = did and kind = 'created'), 'self signup/waiting');
  perform t.chk('walk-in duplicate cpr raises', t.attempt('service_role', null,
    $q$select * from public.register_walk_in_donor('Walk P','777000010','1990-01-01','33335555',null,'unknown',false,false,false,'{}')$q$), 'error:P0001');
  perform t.chk('duplicate burns no number', (select queue_counter::text from public.event), (n0 + 1)::text);
  update public.event set public_registration_open = false;
  perform t.chk('walk-in refused when closed', t.attempt('service_role', null,
    $q$select * from public.register_walk_in_donor('Walk Q','777000011','1990-01-01','33335556',null,'unknown',false,false,false,'{}')$q$), 'error:P0001');
  perform t.chk('closed burns no number', (select queue_counter::text from public.event), (n0 + 1)::text);
  update public.event set public_registration_open = true;

  perform set_config('request.jwt.claim.sub', adm, true);
  set local role authenticated;
  select * into ci from public.check_in_donor(did);
  reset role;
  perform t.chk('desk check-in of a walk-in is a repeat', ci.already_checked_in::text || '/' || ci.queue_number::text || '/' || ci.status,
    'true/' || (n0 + 1)::text || '/waiting');
  perform t.chk('repeat check-in leaves the counter', (select queue_counter::text from public.event), (n0 + 1)::text);

  set local role authenticated;
  insert into public.donors (full_name, cpr, source, slot_id, consent) values ('Desk After', '777000012', 'walk_in', 1, true) returning id into did;
  select * into ci from public.check_in_donor(did);
  reset role;
  perform t.chk('desk check-in continues the same sequence', ci.queue_number::text, (n0 + 2)::text);
  perform t.chk('event_start_time default', (select event_start_time::text from public.event), '08:30:00');

  -- W5: raised and lowered queue start
  update public.event set queue_start = n0 + 100;
  set local role service_role;
  select * into r from public.register_walk_in_donor('Walk R','777000013','1990-01-01','33335557',null,'unknown',false,false,false,'{}');
  reset role;
  perform t.chk('raised start: walk-in jumps to it', r.queue_number::text, (n0 + 100)::text);
  perform set_config('request.jwt.claim.sub', adm, true);
  set local role authenticated;
  insert into public.donors (full_name, cpr, source, slot_id, consent) values ('Desk Later', '777000014', 'walk_in', 1, true) returning id into did;
  select * into ci from public.check_in_donor(did);
  reset role;
  perform t.chk('raised start: next check-in continues', ci.queue_number::text, (n0 + 101)::text);
  update public.event set queue_start = 1;
  set local role authenticated;
  insert into public.donors (full_name, cpr, source, slot_id, consent) values ('Desk Lowered', '777000015', 'walk_in', 1, true) returning id into did;
  select * into ci from public.check_in_donor(did);
  reset role;
  perform t.chk('lowered start: no repeats', ci.queue_number::text, (n0 + 102)::text);
  update public.event set queue_start = 1;
  perform t.chk('queue_start default', (select queue_start::text from public.event), '1');
  perform t.chk('queue_start 0 violates the check', t.attempt(current_user, null, $q$update public.event set queue_start = 0$q$), 'error:23514');
end $$;

-- idempotent signup: submission_id is stored and a repeat is a duplicate
do $$
declare r record; n1 integer; sid constant uuid := 'aaaaaaaa-0000-4000-8000-0000000000aa'; sid2 constant uuid := 'aaaaaaaa-0000-4000-8000-0000000000ab';
begin
  perform set_config('request.jwt.claim.sub', '', true);
  set local role service_role;
  perform public.register_donor('Sub A','888000001','1990-01-01','33336661',null,'unknown',2::smallint,false,false,false,'{}', sid);
  reset role;
  perform t.chk('register_donor stores the submission id',
    (select count(*)::text from public.donors where cpr = '888000001' and submission_id = sid), '1');
  perform t.chk('same submission id with a new cpr raises duplicate_cpr', t.attempt('service_role', null,
    $q$select public.register_donor('Sub B','888000002','1990-01-01','33336662',null,'unknown',2::smallint,false,false,false,'{}','aaaaaaaa-0000-4000-8000-0000000000aa'::uuid)$q$), 'error:P0001');
  set local role service_role;
  select * into r from public.register_walk_in_donor('Sub W','888000003','1990-01-01','33336663',null,'unknown',false,false,false,'{}', sid2);
  reset role;
  perform t.chk('walk-in stores the submission id',
    (select count(*)::text from public.donors where id = r.donor_id and submission_id = sid2), '1');
  select queue_counter into n1 from public.event;
  perform t.chk('walk-in repeat raises duplicate_cpr', t.attempt('service_role', null,
    $q$select * from public.register_walk_in_donor('Sub W2','888000004','1990-01-01','33336664',null,'unknown',false,false,false,'{}','aaaaaaaa-0000-4000-8000-0000000000ab'::uuid)$q$), 'error:P0001');
  perform t.chk('repeat leaves queue_counter unchanged', (select queue_counter::text from public.event), n1::text);
end $$;

select 'FAIL' r, name, detail from t.results where not ok;
select count(*) filter (where ok) as passed, count(*) filter (where not ok) as failed from t.results;
