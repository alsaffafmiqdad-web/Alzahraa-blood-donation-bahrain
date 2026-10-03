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

select 'FAIL' r, name, detail from t.results where not ok;
select count(*) filter (where ok) as passed, count(*) filter (where not ok) as failed from t.results;
