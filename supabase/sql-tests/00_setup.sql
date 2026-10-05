-- Stubs that mimic Supabase: roles, auth schema, auth.uid(), default privileges. Then the real migration.
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as
$$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema public, auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
-- anon and authenticated get Supabase's default privileges (so the migration's revokes are tested).
-- service_role deliberately gets NONE: it simulates "automatically expose new tables" being OFF, so the
-- migration's explicit service_role grants are what the tests exercise.
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;
alter default privileges in schema public grant all on functions to anon, authenticated;
-- psql is run from the repository root by run.sh
\i supabase/migrations/20261003000000_init.sql
\i supabase/migrations/20261004000000_cpr_image.sql
\i supabase/migrations/20261005000000_walk_in_signup.sql
\i supabase/migrations/20261006000000_signup_submission_id.sql
