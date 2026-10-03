#!/bin/bash
# Concurrency tests with pgbench against the scratch DB. $1 = db name.
DB=$1
P="psql -d $DB -q -X -At -v ON_ERROR_STOP=1"
T=$(mktemp -d)
fail=0
report() { if [ "$2" == "$3" ]; then echo "PASS  $1 (got $2)"; else echo "FAIL  $1: got=$2 want=$3"; fail=1; fi; }

# ---------- 1. queue numbers: 60 donors, 12 clients x 40 txns = 480 check-ins, heavy overlap on the same donors
$P -c "delete from public.donors; update public.event set queue_counter=0;"
$P -c "insert into public.donors (full_name,cpr,source,slot_id,consent) select 'D'||g, lpad(g::text,9,'7'), 'walk_in', 1, true from generate_series(1,60) g;"
$P -c "create table if not exists t.donor_ids as select row_number() over (order by id) - 1 as i, id from public.donors; "
cat > $T/checkin.sql <<'SQL'
\set i random(0,59)
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaaaa-0000-4000-8000-000000000001', true);
select queue_number from public.check_in_donor((select id from t.donor_ids where i = :i));
commit;
SQL
$P -c "grant select on t.donor_ids to authenticated; grant usage on schema t to authenticated;"
pgbench -n -f $T/checkin.sql -c 12 -j 4 -t 40 $DB > $T/pgb1.log 2>&1
grep -E "number of failed transactions|processed" $T/pgb1.log | tr '\n' ' '; echo
checked=$($P -c "select count(*) from public.donors where queue_number is not null")
dups=$($P -c "select count(*) from (select queue_number from public.donors where queue_number is not null group by 1 having count(*)>1) x")
mx=$($P -c "select coalesce(max(queue_number),0) from public.donors")
mn=$($P -c "select coalesce(min(queue_number),0) from public.donors")
ctr=$($P -c "select queue_counter from public.event")
nonwaiting=$($P -c "select count(*) from public.donors where queue_number is not null and status <> 'waiting'")
waiting_without_q=$($P -c "select count(*) from public.donors where status='waiting' and queue_number is null")
report "queue: no duplicate queue numbers" "$dups" 0
report "queue: numbers contiguous 1..N (max=N)" "$mx" "$checked"
report "queue: min is 1" "$mn" 1
report "queue: event.queue_counter == N" "$ctr" "$checked"
report "queue: every numbered donor is waiting" "$nonwaiting" 0
report "queue: no waiting donor without a number" "$waiting_without_q" 0
report "queue: all 60 donors checked in" "$checked" 60
verified_rows=$($P -c "select count(*) from public.donor_status_history where kind='status' and to_status='verified'")
waiting_rows=$($P -c "select count(*) from public.donor_status_history where kind='status' and to_status='waiting'")
report "queue: exactly one verified + one waiting history row per donor (no dup history under contention)" "$verified_rows/$waiting_rows" "60/60"

# ---------- 2. slot capacity: slot 3 capacity 5, 60 concurrent signups with distinct CPRs
$P -c "delete from public.donors; update public.slots set capacity=5, active=true where id=3;"
$P -c "create table if not exists t.reg_results (outcome text);" -c "truncate t.reg_results"
$P -c "create or replace function t.try_register(n int) returns void language plpgsql as \$\$
begin
  begin
    perform public.register_donor('R'||n, lpad(n::text,9,'8'), '1990-01-01', null, null, 'unknown', 3::smallint, false, false, false, '{}');
    insert into t.reg_results values ('ok');
  exception when others then insert into t.reg_results values (sqlerrm);
  end;
end \$\$;" -c "grant execute on function t.try_register(int) to service_role; grant all on t.reg_results to service_role;"
cat > $T/reg.sql <<'SQL'
\set n random(1,100000000)
set role service_role;
select t.try_register(:n);
SQL
pgbench -n -f $T/reg.sql -c 20 -j 4 -t 3 $DB > $T/pgb2.log 2>&1
ok=$($P -c "select count(*) from t.reg_results where outcome='ok'")
full=$($P -c "select count(*) from t.reg_results where outcome='slot_full'")
other=$($P -c "select count(*) from t.reg_results where outcome not in ('ok','slot_full')")
inslot=$($P -c "select count(*) from public.donors where slot_id=3")
report "slot: exactly capacity (5) donors in slot after 60 concurrent signups" "$inslot" 5
report "slot: 5 successes" "$ok" 5
report "slot: other attempts rejected as slot_full (a few duplicate random cprs excluded)" "$other" 0
report "slot: total outcomes 60" "$($P -c 'select count(*) from t.reg_results')" 60

# ---------- 3. same CPR concurrently: exactly one row
$P -c "truncate t.reg_results; update public.slots set capacity=100 where id=3;"
cat > $T/dup.sql <<'SQL'
set role service_role;
select t.try_register(424242);
SQL
pgbench -n -f $T/dup.sql -c 16 -j 4 -t 2 $DB > $T/pgb3.log 2>&1
report "dup cpr: exactly 1 row" "$($P -c "select count(*) from public.donors where cpr='424242424'" | head -1)" "0"  >/dev/null
rows=$($P -c "select count(*) from public.donors where cpr = lpad('424242',9,'8')")
report "dup cpr: exactly 1 donor for 32 concurrent same-cpr signups" "$rows" 1
report "dup cpr: others got duplicate_cpr" "$($P -c "select count(*) from t.reg_results where outcome='duplicate_cpr'")" 31

# ---------- 4. email budget: budget 10, 60 concurrent claims
$P -c "truncate public.email_sends;"
cat > $T/claim.sql <<'SQL'
set role service_role;
select public.claim_email_send(null, 10);
SQL
pgbench -n -f $T/claim.sql -c 20 -j 4 -t 3 $DB > $T/pgb4.log 2>&1
report "email budget: exactly 10 claims granted under concurrency" "$($P -c 'select count(*) from public.email_sends')" 10

# ---------- 5. rate limit: limit 5, 40 concurrent hits same key
$P -c "truncate public.rate_limits; create table if not exists t.rl (allowed boolean); truncate t.rl; grant all on t.rl to service_role;"
cat > $T/rl.sql <<'SQL'
set role service_role;
insert into t.rl select public.rate_limit_hit('ip-hash', 5, 600);
SQL
pgbench -n -f $T/rl.sql -c 20 -j 4 -t 2 $DB > $T/pgb5.log 2>&1
report "rate limit: exactly 5 of 40 concurrent hits allowed" "$($P -c 'select count(*) from t.rl where allowed')" 5
report "rate limit: hits counter 40" "$($P -c "select hits from public.rate_limits where key='ip-hash'")" 40

rm -rf $T
exit $fail
