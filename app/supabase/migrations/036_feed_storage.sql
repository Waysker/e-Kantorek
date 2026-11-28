-- Kantorek attachments: private Storage bucket "feed" and its policies.
-- Run as supabase_admin (storage.objects belongs to supabase_storage_admin;
-- postgres may not create policies on it):
--   sudo docker exec -i supabase-db psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 < 036_feed_storage.sql
-- Members read every file in the bucket and write only under their own uid
-- folder; the app shows files through signed URLs (1 h).

-- Private bucket; members read everything in it, write only under their uid.
do $$
begin
  if to_regclass('storage.buckets') is null then
    raise notice 'storage schema missing: bucket "feed" not created';
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values (
    'feed', 'feed', false, 10485760,
    array[
      'image/jpeg', 'image/png', 'image/webp', 'image/gif',
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel', 'application/msword', 'text/plain'
    ]
  )
  on conflict (id) do update
    set public = excluded.public,
        file_size_limit = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types;

  execute 'drop policy if exists "Feed files: members read" on storage.objects';
  execute $p$create policy "Feed files: members read" on storage.objects
    for select to authenticated using (bucket_id = 'feed')$p$;
  execute 'drop policy if exists "Feed files: upload own" on storage.objects';
  execute $p$create policy "Feed files: upload own" on storage.objects
    for insert to authenticated
    with check (bucket_id = 'feed' and (storage.foldername(name))[1] = auth.uid()::text)$p$;
  execute 'drop policy if exists "Feed files: delete own" on storage.objects';
  execute $p$create policy "Feed files: delete own" on storage.objects
    for delete to authenticated
    using (bucket_id = 'feed' and (storage.foldername(name))[1] = auth.uid()::text)$p$;
end;
$$;
