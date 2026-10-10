-- pgTAP tests. Run with: supabase start && supabase db reset && supabase test db
begin;
select plan(33);

-- ===== Fixtures (as the postgres superuser) =====
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin@example.org'),
  ('00000000-0000-0000-0000-0000000000a2', 'plain@example.org');
insert into public.admins (user_id, display_name) values ('00000000-0000-0000-0000-0000000000a1', 'Admin One');

insert into public.slots (starts_at, capacity) values ('20:00', 1);

insert into public.donors (id, full_name, cpr, source, consent) values
  ('11111111-1111-4111-8111-111111111111', 'Walk One', '200000001', 'walk_in', true),
  ('22222222-2222-4222-8222-222222222222', 'Walk Two', '200000002', 'walk_in', true),
  ('33333333-3333-4333-8333-333333333333', 'Walk Three', '200000003', 'walk_in', true);
insert into public.donors (id, full_name, cpr, source, consent, status) values
  ('44444444-4444-4444-8444-444444444444', 'Late Arrival', '200000004', 'walk_in', true, 'no_show'),
  ('55555555-5555-4555-8555-555555555555', 'Deferred One', '200000005', 'walk_in', true, 'deferred');

-- ===== RLS enabled on every public table =====
select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity),
  0, 'RLS is enabled on every public table');

-- ===== anon =====
set local role anon;
select throws_ok('select * from public.donors', '42501', null, 'anon cannot select donors');
select throws_ok(
  $$insert into public.donors (full_name, cpr, source, consent) values ('x', '300000001', 'walk_in', true)$$,
  '42501', null, 'anon cannot insert donors');
select throws_ok('select public.slot_availability()', '42501', null, 'anon cannot call slot_availability');
reset role;

-- ===== authenticated non-admin =====
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from public.donors), 0, 'non-admin sees no donors');
select is((select count(*)::int from public.slots), 0, 'non-admin sees no slots');
select throws_ok(
  $$select * from public.check_in_donor('11111111-1111-4111-8111-111111111111')$$,
  'P0001', 'not_authorized', 'non-admin cannot check in');
select throws_ok('select * from public.rate_limits', '42501', null, 'authenticated cannot read rate_limits');
reset role;

-- ===== service_role: register_donor =====
set local role service_role;
select ok(
  (select public.register_donor('Reg One', '100000001', null, '11111111', null, 'unknown', 1::smallint, false, false, false, '{}')) is not null,
  'register_donor returns an id');
select throws_ok(
  $$select public.register_donor('Reg Dup', '100000001', null, '11111111', null, 'unknown', 1::smallint, false, false, false, '{}')$$,
  'P0001', 'duplicate_cpr', 'duplicate CPR is rejected');
reset role;

set local role service_role;
select ok(
  (select public.register_donor('Cap One', '100000002', null, '22222222', null, 'unknown',
     (select id from public.slots where starts_at = '20:00'), true, false, true, '{recent_donation}'::text[])) is not null,
  'filling a capacity-1 slot works');
select throws_ok(
  $$select public.register_donor('Cap Two', '100000003', null, '33333333', null, 'unknown',
     (select id from public.slots where starts_at = '20:00'), false, false, false, '{}')$$,
  'P0001', 'slot_full', 'a full slot is rejected');
select is(
  (select booked from public.slot_availability() where starts_at = '20:00'), 1,
  'slot_availability counts bookings');
reset role;

select ok(
  (select flagged from public.donors where cpr = '100000002'),
  'flag set by the server is stored');

-- ===== admin: check_in_donor =====
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select is((select queue_number from public.check_in_donor('11111111-1111-4111-8111-111111111111')), 1, 'first check-in gets queue 1');
select is((select queue_number from public.check_in_donor('22222222-2222-4222-8222-222222222222')), 2, 'second check-in gets queue 2');
select is((select queue_number from public.check_in_donor('33333333-3333-4333-8333-333333333333')), 3, 'third check-in gets queue 3');
select is(
  (select already_checked_in from public.check_in_donor('22222222-2222-4222-8222-222222222222')), true,
  'repeat check-in reports already_checked_in');
select is((select queue_number from public.check_in_donor('22222222-2222-4222-8222-222222222222')), 2, 'repeat check-in keeps the number');
select is(
  (select count(*)::int from public.donor_status_history
    where donor_id = '11111111-1111-4111-8111-111111111111' and to_status = 'verified'), 1,
  'registered donor got a verified history row');
select is(
  (select count(*)::int from public.donor_status_history
    where donor_id = '11111111-1111-4111-8111-111111111111' and to_status = 'waiting' and changed_by_name = 'Admin One'), 1,
  'and a waiting history row naming the admin');

-- late arrival: a no_show donor can be checked in and takes the next queue number
select is((select queue_number from public.check_in_donor('44444444-4444-4444-8444-444444444444')), 4, 'no_show donor can be checked in (queue 4)');
select is((select status from public.donors where id = '44444444-4444-4444-8444-444444444444'), 'waiting', 'and is now waiting');
-- deferred is refused with the real state, no queue number, status unchanged
select is(
  (select queue_number from public.check_in_donor('55555555-5555-4555-8555-555555555555')), null::int,
  'deferred donor is refused: no queue number');
select is(
  (select already_checked_in from public.check_in_donor('55555555-5555-4555-8555-555555555555')), true,
  'deferred donor is reported as not checked in by this call');
select is((select status from public.donors where id = '55555555-5555-4555-8555-555555555555'), 'deferred', 'and stays deferred');
reset role;

-- ===== service_role: rate limit peek =====
set local role service_role;
select is((select public.rate_limit_peek('pgtap', 1, 600)), true, 'peek is allowed on a fresh key');
select ok((select public.rate_limit_hit('pgtap', 1, 600)), 'first counted hit is allowed');
select is((select public.rate_limit_peek('pgtap', 1, 600)), false, 'peek is refused once the limit is reached');
reset role;

-- ===== service_role: email budget =====
set local role service_role;
select ok((select public.claim_email_send(null, 2)) is not null, 'budget claim 1');
select ok((select public.claim_email_send(null, 2)) is not null, 'budget claim 2');
select is((select public.claim_email_send(null, 2)), null::bigint, 'budget claim 3 is refused');
select is((select public.email_budget_remaining(2)), 0, 'email_budget_remaining agrees: none left');
reset role;

select * from finish();
rollback;
