#!/bin/bash
# Plain-Postgres test suite for the migration: RLS matrix, history trigger, check-in, budgets, concurrency.
#   Usage: bash supabase/sql-tests/run.sh
# Needs psql and pgbench on PATH and a Postgres you can create databases on (uses the standard PG* env
# vars, default local socket). It creates a scratch database and the cluster-level roles anon,
# authenticated and service_role, then drops them. Do NOT point it at a database you care about,
# and not at a Supabase project (the stub script creates the roles and an auth schema itself).
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
DB=${ALZ_TEST_DB:-alz_sql_test}
cd "$REPO"
fail=0
psql -d postgres -qc "drop database if exists $DB" -c "create database $DB" || exit 2
P="psql -d $DB -q -v ON_ERROR_STOP=1 -X"
cleanup() {
  psql -d postgres -qc "drop database if exists $DB"
  psql -d postgres -qc "drop role if exists anon" -c "drop role if exists authenticated" -c "drop role if exists service_role"
}
trap cleanup EXIT
$P -f "$HERE/00_setup.sql" >"${TMPDIR:-/tmp}/alz_setup.log" 2>&1 || { echo "SETUP FAILED"; tail -20 "${TMPDIR:-/tmp}/alz_setup.log"; exit 2; }
for f in 10_rls.sql 20_history_tests.sql 25_features.sql; do
  echo "== $f"
  out=$($P -At -f "$HERE/$f") || { echo "$out"; fail=1; }
  echo "$out"
  echo "$out" | grep -q '^FAIL' && fail=1
  echo "$out" | tail -1 | grep -qE '\|0$' || fail=1
done
echo "== 30_concurrency.sh"
bash "$HERE/30_concurrency.sh" "$DB" | tee /dev/stderr | grep -q '^FAIL' && fail=1
[ $fail -eq 0 ] && echo "ALL SQL TESTS PASSED" || echo "SQL TESTS FAILED"
exit $fail
