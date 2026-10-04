alter table public.donors add column cpr_image_path text
  check (cpr_image_path is null or cpr_image_path ~ '^[0-9a-f-]{36}/cpr\.(jpg|png|webp)$');

-- Private bucket + admin read/delete. Guarded so the plain-Postgres test suite (no storage schema) still applies it.
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('cpr-images', 'cpr-images', false, 2000000, array['image/jpeg','image/png','image/webp'])
    on conflict (id) do nothing;
    execute $p$create policy "admins read cpr images" on storage.objects for select to authenticated
      using (bucket_id = 'cpr-images' and (select public.is_admin()))$p$;
    execute $p$create policy "admins delete cpr images" on storage.objects for delete to authenticated
      using (bucket_id = 'cpr-images' and (select public.is_admin()))$p$;
  end if;
end $$;
