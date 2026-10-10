-- Admin-managed theme colours, link preview image and WhatsApp number (on the event row), plus
-- admin-editable status display names (status_labels), plus the public site-assets bucket.
-- This migration adds no functions, so there is nothing to revoke execute on.
-- (touch_updated_at is an existing trigger function.)

alter table public.event
  add column theme_accent text not null default '#093f4c' check (theme_accent ~ '^#[0-9a-f]{6}$'),
  add column theme_background text not null default '#fbf7f2' check (theme_background ~ '^#[0-9a-f]{6}$'),
  add column og_image_path text check (og_image_path is null or og_image_path ~ '^og/[0-9]{13}\.(jpg|png)$'),
  add column whatsapp_number text not null default '' check (whatsapp_number ~ '^([0-9]{8,15})?$');

-- One row per fixed status key. Admins can rename (update label) but not insert or delete.
create table public.status_labels (
  status text primary key
    check (status in ('registered','verified','waiting','screening','donated','deferred','no_show')),
  label text not null
    check (char_length(label) between 1 and 40
           and label = btrim(label)
           and position(U&'\2013' in label) = 0
           and position(U&'\2014' in label) = 0),
  updated_at timestamptz not null default now()
);
create unique index status_labels_label_lower_idx on public.status_labels (lower(label));
create trigger status_labels_touch before update on public.status_labels
  for each row execute function public.touch_updated_at();
insert into public.status_labels (status, label) values
  ('registered','Registered'), ('verified','Verified (before the event)'),
  ('waiting','Registration Station'), ('screening','Doctor Station'),
  ('donated','Donation Reception'), ('deferred','Deferred'), ('no_show','No show (after half time)');

alter table public.status_labels enable row level security;
create policy "admins read status labels" on public.status_labels for select to authenticated
  using ((select public.is_admin()));
create policy "admins update status labels" on public.status_labels for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
revoke all on public.status_labels from anon, authenticated;
grant select, update (label) on public.status_labels to authenticated;   -- no insert/delete: keys are fixed
grant select, insert, update, delete on public.status_labels to service_role;

-- Public bucket for the link preview image (no personal data; crawlers must be able to fetch it).
-- Guarded so the plain-Postgres test suite (no storage schema) still applies it.
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('site-assets', 'site-assets', true, 900000, array['image/jpeg','image/png'])
    on conflict (id) do nothing;
    execute $p$create policy "admins read site assets" on storage.objects for select to authenticated
      using (bucket_id = 'site-assets' and (select public.is_admin()))$p$;
    execute $p$create policy "admins upload site assets" on storage.objects for insert to authenticated
      with check (bucket_id = 'site-assets' and (select public.is_admin()))$p$;
    execute $p$create policy "admins delete site assets" on storage.objects for delete to authenticated
      using (bucket_id = 'site-assets' and (select public.is_admin()))$p$;
  end if;
end $$;
