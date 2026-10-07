\set ON_ERROR_STOP on
create schema t;
grant usage on schema t to public;
create table t.results (name text, ok boolean, detail text);
grant all on t.results to public;

insert into auth.users values ('aaaaaaaa-0000-4000-8000-000000000001'), ('bbbbbbbb-0000-4000-8000-000000000002');
insert into public.admins values ('aaaaaaaa-0000-4000-8000-000000000001', 'Admin A');
insert into public.donors (full_name, cpr, source, slot_id, consent) values ('Seed Donor', '111111111', 'admin_added', 1, true);
insert into public.email_sends (status) values ('sent');
insert into public.rate_limits values ('k', now(), 1);

create table t.stmts (tbl text, op text, sql text);
insert into t.stmts values
 ('admins','select','select * from public.admins'),
 ('admins','insert',$$insert into public.admins values ('bbbbbbbb-0000-4000-8000-000000000002','Evil')$$),
 ('admins','update',$$update public.admins set display_name='h'$$),
 ('admins','delete','delete from public.admins'),
 ('event','select','select * from public.event'),
 ('event','insert',$$insert into public.event (id,name_ar,name_en,event_date) values (false,'a','b','2026-01-01')$$),
 ('event','update',$$update public.event set name_en='hacked'$$),
 ('event','delete','delete from public.event'),
 ('slots','select','select * from public.slots'),
 ('slots','insert',$$insert into public.slots (starts_at,capacity) values ('23:00',5)$$),
 ('slots','update','update public.slots set capacity=1'),
 ('slots','delete','delete from public.slots'),
 ('donors','select','select * from public.donors'),
 ('donors','insert',$$insert into public.donors (full_name,cpr,source,slot_id,consent) values ('Evil','222222222','admin_added',1,true)$$),
 ('donors','update',$$update public.donors set notes='hacked'$$),
 ('donors','delete','delete from public.donors'),
 ('donor_status_history','select','select * from public.donor_status_history'),
 ('donor_status_history','insert',$$insert into public.donor_status_history (donor_id,kind,to_status,changed_by_name) select id,'status','donated','forged' from public.donors limit 1$$),
 ('donor_status_history','update',$$update public.donor_status_history set changed_by_name='forged'$$),
 ('donor_status_history','delete','delete from public.donor_status_history'),
 ('email_sends','select','select * from public.email_sends'),
 ('email_sends','insert',$$insert into public.email_sends (status) values ('sent')$$),
 ('email_sends','update',$$update public.email_sends set status='failed'$$),
 ('email_sends','delete','delete from public.email_sends'),
 ('rate_limits','select','select * from public.rate_limits'),
 ('rate_limits','insert',$$insert into public.rate_limits values ('z', now(), 1)$$),
 ('rate_limits','update','update public.rate_limits set hits=0'),
 ('rate_limits','delete','delete from public.rate_limits');

-- Runs sql as role r with jwt sub; ALWAYS rolls the statement back. 'denied' | 'rows=N' | 'error:SQLSTATE'
create function t.attempt(r text, sub text, stmt text) returns text language plpgsql as $$
declare n bigint; out text;
begin
  execute format('set local role %I', r);
  perform set_config('request.jwt.claim.sub', coalesce(sub, ''), true);
  begin
    execute stmt;
    get diagnostics n = row_count;
    raise exception 'rolled back' using errcode = 'RB001', detail = 'rows=' || n;
  exception
    when insufficient_privilege then out := 'denied';
    when sqlstate 'RB001' then get stacked diagnostics out = pg_exception_detail;
    when others then out := 'error:' || sqlstate;
  end;
  execute 'reset role';
  return out;
end $$;

create procedure t.check(name text, got text, want text) language plpgsql as $$
begin insert into t.results values (name, got = want, 'got=' || got || ' want=' || want); end $$;

create function t.chk(name text, got text, want text) returns void language plpgsql as $$
begin insert into t.results values (name, got = want, 'got=' || got || ' want=' || want); end $$;

do $$
declare s record; a record; res text; verdict text;
begin
  -- 1. anon and authenticated non-admins (and authenticated with no jwt): blocked on every table and op
  for a in select * from (values ('anon', null), ('authenticated', 'bbbbbbbb-0000-4000-8000-000000000002'), ('authenticated', null)) x(r, sub) loop
    for s in select * from t.stmts loop
      res := t.attempt(a.r, a.sub, s.sql);
      verdict := case when res = 'denied' or res = 'rows=0' then 'blocked' else res end;
      call t.check(format('BLOCKED %s/%s %s.%s', a.r, coalesce(left(a.sub,2),'nojwt'), s.tbl, s.op), verdict, 'blocked');
    end loop;
  end loop;

  -- 2. admin control: exactly the policy matrix
  for s in select * from t.stmts loop
    res := t.attempt('authenticated', 'aaaaaaaa-0000-4000-8000-000000000001', s.sql);
    verdict := case
      when s.tbl in ('email_sends','rate_limits') then 'denied'
      when s.tbl = 'donor_status_history' and s.op <> 'select' then 'denied'
      when s.tbl = 'admins' and s.op <> 'select' then 'denied'
      when s.tbl = 'event' and s.op in ('insert','delete') then 'denied'
      else 'allowed' end;
    call t.check(format('ADMIN %s.%s', s.tbl, s.op), case when res = 'denied' then 'denied' when (res like 'rows=%' and res <> 'rows=0') or (s.tbl = 'slots' and s.op = 'delete' and res = 'error:23503') then 'allowed' else res end, verdict);
  end loop;

  -- 3. service_role can use email_sends / rate_limits (needed by the app)
  call t.check('SERVICE email_sends select', t.attempt('service_role', null, 'select * from public.email_sends'), 'rows=1');
  call t.check('SERVICE rate_limits select', t.attempt('service_role', null, 'select * from public.rate_limits'), 'rows=1');

  -- 4. RPC surface
  call t.check('anon is_admin()', t.attempt('anon', null, 'select public.is_admin()'), 'denied');
  call t.check('anon check_in_donor', t.attempt('anon', null, $q$select * from public.check_in_donor(gen_random_uuid())$q$), 'denied');
  call t.check('anon slot_availability', t.attempt('anon', null, 'select * from public.slot_availability()'), 'denied');
  call t.check('anon register_donor', t.attempt('anon', null, $q$select public.register_donor('x','333333333',null,null,null,'unknown',1::smallint,false,false,false,'{}')$q$), 'denied');
  call t.check('anon register_walk_in_donor', t.attempt('anon', null, $q$select * from public.register_walk_in_donor('x','444444445',null,null,null,'unknown',false,false,false,'{}')$q$), 'denied');
  call t.check('anon next_queue_number', t.attempt('anon', null, 'select public.next_queue_number()'), 'denied');
  call t.check('anon claim_email_send', t.attempt('anon', null, $q$select public.claim_email_send(null,100)$q$), 'denied');
  call t.check('anon finish_email_send', t.attempt('anon', null, $q$select public.finish_email_send(1,true,null)$q$), 'denied');
  call t.check('anon rate_limit_hit', t.attempt('anon', null, $q$select public.rate_limit_hit('a',5,60)$q$), 'denied');
  call t.check('anon daily_maintenance', t.attempt('anon', null, 'select public.daily_maintenance()'), 'denied');
  call t.check('authed register_donor', t.attempt('authenticated', 'aaaaaaaa-0000-4000-8000-000000000001', $q$select public.register_donor('x','333333333',null,null,null,'unknown',1::smallint,false,false,false,'{}')$q$), 'denied');
  call t.check('authed register_walk_in_donor', t.attempt('authenticated', 'aaaaaaaa-0000-4000-8000-000000000001', $q$select * from public.register_walk_in_donor('x','444444445',null,null,null,'unknown',false,false,false,'{}')$q$), 'denied');
  call t.check('authed next_queue_number', t.attempt('authenticated', 'aaaaaaaa-0000-4000-8000-000000000001', 'select public.next_queue_number()'), 'denied');
  call t.check('authed slot_availability', t.attempt('authenticated', 'aaaaaaaa-0000-4000-8000-000000000001', 'select * from public.slot_availability()'), 'denied');
  call t.check('authed claim_email_send', t.attempt('authenticated', 'aaaaaaaa-0000-4000-8000-000000000001', $q$select public.claim_email_send(null,100)$q$), 'denied');
  call t.check('authed rate_limit_hit', t.attempt('authenticated', 'aaaaaaaa-0000-4000-8000-000000000001', $q$select public.rate_limit_hit('a',5,60)$q$), 'denied');
  call t.check('authed daily_maintenance', t.attempt('authenticated', 'aaaaaaaa-0000-4000-8000-000000000001', 'select public.daily_maintenance()'), 'denied');
  call t.check('non-admin check_in_donor -> not_authorized',
    t.attempt('authenticated', 'bbbbbbbb-0000-4000-8000-000000000002', $q$select * from public.check_in_donor((select id from public.donors limit 1))$q$), 'error:P0001');
  call t.check('service_role register_donor ok', t.attempt('service_role', null, $q$select public.register_donor('Svc','444444444','1990-01-01','33334444','a@b.com','O+',1::smallint,false,false,false,'{}')$q$), 'rows=1');
  call t.check('service_role register_walk_in_donor ok', t.attempt('service_role', null, $q$select * from public.register_walk_in_donor('Svc W','444444445','1990-01-01','33334445',null,'O+',false,false,false,'{}')$q$), 'rows=1');
  call t.check('service_role slot_availability ok', t.attempt('service_role', null, 'select * from public.slot_availability()'), 'rows=11');

  -- 5. Grant regression: catalog-wide checks that catch a function or table a new migration forgot to revoke
  perform t.chk('no public function executable by anon',
    (select coalesce(string_agg(p.proname, ','), 'none') from pg_proc p
      where p.pronamespace = 'public'::regnamespace
        and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
        and has_function_privilege('anon', p.oid, 'execute')), 'none');
  perform t.chk('only is_admin and check_in_donor executable by authenticated',
    (select coalesce(string_agg(p.proname, ',' order by p.proname), 'none') from pg_proc p
      where p.pronamespace = 'public'::regnamespace
        and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
        and has_function_privilege('authenticated', p.oid, 'execute')), 'check_in_donor,is_admin');
  perform t.chk('every security definer function in public sets search_path',
    (select coalesce(string_agg(p.proname, ','), 'none') from pg_proc p
      where p.pronamespace = 'public'::regnamespace and p.prosecdef
        and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
        and not exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) c where c like 'search_path=%')), 'none');
  perform t.chk('anon has no privilege on any public table',
    (select coalesce(string_agg(c.relname, ','), 'none') from pg_class c
      where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'v', 'm', 'p', 'f')
        and has_table_privilege('anon', c.oid, 'select, insert, update, delete, truncate, references, trigger')), 'none');
end $$;

select case when ok then 'PASS' else 'FAIL' end as r, name, detail from t.results where not ok;
select count(*) filter (where ok) as passed, count(*) filter (where not ok) as failed from t.results;
