-- Kantorek: the orchestra's feed (Partytura → Patterns → Kantorek (feed)).
-- Every signed-in member posts, comments, likes and votes; board and admins
-- pin and delete anything. Tables are readable by authenticated users; every
-- write goes through the security definer RPCs below, which take the author
-- from auth.uid().
--
-- Attachments: the client uploads to the private Storage bucket "feed" under
-- "<auth.uid()>/<random>/<file name>" first, then passes the paths to
-- create_feed_post, which checks that each path is the caller's own.
-- Push: push_new_events announces posts with notified_at null
-- (claim_feed_posts_for_push); push_subscriptions.topics says who wants them.

-- ---------------------------------------------------------------- tables

create table if not exists public.feed_posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid references auth.users(id) on delete set null,
  body text not null default '' check (char_length(body) <= 5000),
  pinned_at timestamptz,
  pinned_by uuid,
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  notified_at timestamptz
);

create index if not exists idx_feed_posts_created on public.feed_posts (created_at desc);
create index if not exists idx_feed_posts_pinned on public.feed_posts (pinned_at desc) where pinned_at is not null;
create index if not exists idx_feed_posts_unnotified on public.feed_posts (created_at) where notified_at is null;

create table if not exists public.feed_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.feed_posts(id) on delete cascade,
  author_id uuid references auth.users(id) on delete set null,
  body text not null check (char_length(trim(body)) between 1 and 2000),
  created_at timestamptz not null default now(),
  edited_at timestamptz
);

create index if not exists idx_feed_comments_post on public.feed_comments (post_id, created_at);

create table if not exists public.feed_reactions (
  post_id uuid not null references public.feed_posts(id) on delete cascade,
  profile_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, profile_id)
);

create table if not exists public.feed_polls (
  post_id uuid primary key references public.feed_posts(id) on delete cascade,
  question text not null check (char_length(trim(question)) between 1 and 300),
  multiple boolean not null default false
);

create table if not exists public.feed_poll_options (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.feed_polls(post_id) on delete cascade,
  position integer not null,
  label text not null check (char_length(trim(label)) between 1 and 200),
  unique (post_id, position)
);

create table if not exists public.feed_poll_votes (
  option_id uuid not null references public.feed_poll_options(id) on delete cascade,
  post_id uuid not null references public.feed_polls(post_id) on delete cascade,
  profile_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (option_id, profile_id)
);

create index if not exists idx_feed_poll_votes_post on public.feed_poll_votes (post_id);

create table if not exists public.feed_attachments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.feed_posts(id) on delete cascade,
  position integer not null,
  storage_path text not null unique,
  kind text not null check (kind in ('image', 'file')),
  file_name text not null check (char_length(file_name) between 1 and 200),
  mime_type text,
  size_bytes integer check (size_bytes between 0 and 10485760),
  width integer,
  height integer
);

create index if not exists idx_feed_attachments_post on public.feed_attachments (post_id, position);

-- Which push topics this browser wants (Ja → Powiadomienia). Existing
-- subscriptions said yes to "Włącz", which now means both.
alter table public.push_subscriptions
  add column if not exists topics text[] not null default array['new_event', 'new_post'];

-- ---------------------------------------------------------------- access

alter table public.feed_posts enable row level security;
alter table public.feed_comments enable row level security;
alter table public.feed_reactions enable row level security;
alter table public.feed_polls enable row level security;
alter table public.feed_poll_options enable row level security;
alter table public.feed_poll_votes enable row level security;
alter table public.feed_attachments enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['feed_posts', 'feed_comments', 'feed_reactions', 'feed_polls',
                           'feed_poll_options', 'feed_poll_votes', 'feed_attachments']
  loop
    execute format('revoke all on table public.%I from public, anon, authenticated', t);
    execute format('grant select on table public.%I to authenticated', t);
    execute format('drop policy if exists "Members read the feed" on public.%I', t);
    execute format('create policy "Members read the feed" on public.%I for select to authenticated using (true)', t);
  end loop;
end;
$$;

create or replace function public.feed_is_moderator(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = p_uid and role in ('board', 'zarzad', 'admin')
  );
$$;

create or replace function public.feed_require_uid()
returns uuid
language plpgsql
stable
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  return v_uid;
end;
$$;

-- ---------------------------------------------------------------- posts

-- p_poll: null or {"question": "...", "multiple": false, "options": ["A", "B"]}
-- p_attachments: [{"path", "kind", "fileName", "mimeType", "sizeBytes", "width", "height"}]
create or replace function public.create_feed_post(
  p_body text,
  p_poll jsonb default null,
  p_attachments jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.feed_require_uid();
  v_post uuid;
  v_body text := trim(coalesce(p_body, ''));
  v_options jsonb;
  v_attachment jsonb;
  v_index integer := 0;
begin
  if jsonb_typeof(coalesce(p_attachments, '[]'::jsonb)) <> 'array' then
    raise exception 'invalid_attachments' using errcode = '22023';
  end if;
  if jsonb_array_length(coalesce(p_attachments, '[]'::jsonb)) > 6 then
    raise exception 'too_many_attachments' using errcode = '22023';
  end if;
  if v_body = '' and p_poll is null and jsonb_array_length(coalesce(p_attachments, '[]'::jsonb)) = 0 then
    raise exception 'empty_post' using errcode = '22023';
  end if;

  insert into public.feed_posts (author_id, body) values (v_uid, v_body) returning id into v_post;

  if p_poll is not null then
    v_options := p_poll -> 'options';
    if jsonb_typeof(v_options) <> 'array'
       or jsonb_array_length(v_options) not between 2 and 10 then
      raise exception 'poll_needs_2_to_10_options' using errcode = '22023';
    end if;
    insert into public.feed_polls (post_id, question, multiple)
    values (v_post, trim(p_poll ->> 'question'), coalesce((p_poll ->> 'multiple')::boolean, false));
    insert into public.feed_poll_options (post_id, position, label)
    select v_post, ordinality::integer, trim(value)
    from jsonb_array_elements_text(v_options) with ordinality;
  end if;

  for v_attachment in select value from jsonb_array_elements(coalesce(p_attachments, '[]'::jsonb))
  loop
    v_index := v_index + 1;
    if split_part(v_attachment ->> 'path', '/', 1) <> v_uid::text then
      raise exception 'attachment_not_yours' using errcode = '42501';
    end if;
    insert into public.feed_attachments (
      post_id, position, storage_path, kind, file_name, mime_type, size_bytes, width, height
    ) values (
      v_post,
      v_index,
      v_attachment ->> 'path',
      coalesce(v_attachment ->> 'kind', 'file'),
      left(coalesce(nullif(trim(v_attachment ->> 'fileName'), ''), 'plik'), 200),
      v_attachment ->> 'mimeType',
      (v_attachment ->> 'sizeBytes')::integer,
      (v_attachment ->> 'width')::integer,
      (v_attachment ->> 'height')::integer
    );
  end loop;

  return v_post;
end;
$$;

create or replace function public.update_feed_post(p_post_id uuid, p_body text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.feed_require_uid();
begin
  update public.feed_posts
  set body = trim(coalesce(p_body, '')), edited_at = now()
  where id = p_post_id and author_id = v_uid;
  if not found then
    raise exception 'not_your_post' using errcode = '42501';
  end if;
end;
$$;

-- Returns the storage paths of the deleted post's attachments, so the client
-- can remove its own files from Storage.
create or replace function public.delete_feed_post(p_post_id uuid)
returns text[]
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.feed_require_uid();
  v_paths text[];
begin
  select coalesce(array_agg(storage_path), '{}') into v_paths
  from public.feed_attachments where post_id = p_post_id;

  delete from public.feed_posts
  where id = p_post_id
    and (author_id = v_uid or public.feed_is_moderator(v_uid));
  if not found then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  return v_paths;
end;
$$;

create or replace function public.set_feed_post_pinned(p_post_id uuid, p_pinned boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.feed_require_uid();
begin
  if not public.feed_is_moderator(v_uid) then
    raise exception 'only_board' using errcode = '42501';
  end if;
  update public.feed_posts
  set pinned_at = case when p_pinned then now() end,
      pinned_by = case when p_pinned then v_uid end
  where id = p_post_id;
end;
$$;

-- ---------------------------------------------------------------- comments

create or replace function public.add_feed_comment(p_post_id uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.feed_require_uid();
  v_id uuid;
begin
  insert into public.feed_comments (post_id, author_id, body)
  values (p_post_id, v_uid, trim(coalesce(p_body, '')))
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.update_feed_comment(p_comment_id uuid, p_body text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.feed_require_uid();
begin
  update public.feed_comments
  set body = trim(coalesce(p_body, '')), edited_at = now()
  where id = p_comment_id and author_id = v_uid;
  if not found then
    raise exception 'not_your_comment' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.delete_feed_comment(p_comment_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.feed_require_uid();
begin
  delete from public.feed_comments
  where id = p_comment_id
    and (author_id = v_uid or public.feed_is_moderator(v_uid));
  if not found then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
end;
$$;

-- ---------------------------------------------------------------- likes and votes

-- Toggles "Lubię to"; returns true when the caller now likes the post.
create or replace function public.toggle_feed_reaction(p_post_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.feed_require_uid();
begin
  delete from public.feed_reactions where post_id = p_post_id and profile_id = v_uid;
  if found then
    return false;
  end if;
  insert into public.feed_reactions (post_id, profile_id) values (p_post_id, v_uid);
  return true;
end;
$$;

-- Replaces the caller's votes in a poll; an empty array withdraws them.
create or replace function public.vote_feed_poll(p_post_id uuid, p_option_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.feed_require_uid();
  v_multiple boolean;
  v_valid integer;
  v_wanted integer := coalesce(cardinality(p_option_ids), 0);
begin
  select multiple into v_multiple from public.feed_polls where post_id = p_post_id;
  if not found then
    raise exception 'no_poll' using errcode = '22023';
  end if;
  if not v_multiple and v_wanted > 1 then
    raise exception 'single_choice' using errcode = '22023';
  end if;
  select count(*) into v_valid
  from public.feed_poll_options
  where post_id = p_post_id and id = any(coalesce(p_option_ids, '{}'));
  if v_valid <> (select count(distinct x) from unnest(coalesce(p_option_ids, '{}')) as x) then
    raise exception 'unknown_option' using errcode = '22023';
  end if;

  delete from public.feed_poll_votes where post_id = p_post_id and profile_id = v_uid;
  insert into public.feed_poll_votes (option_id, post_id, profile_id)
  select distinct x, p_post_id, v_uid from unnest(coalesce(p_option_ids, '{}')) as x;
end;
$$;

-- ---------------------------------------------------------------- reading

create or replace function public.feed_post_json(p_post_id uuid, p_uid uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', p.id,
    'authorId', p.author_id,
    'authorName', coalesce(pr.full_name, 'Konto usunięte'),
    'body', p.body,
    'createdAt', p.created_at,
    'editedAt', p.edited_at,
    'pinned', p.pinned_at is not null,
    'mine', p.author_id = p_uid,
    'likeCount', (select count(*) from public.feed_reactions r where r.post_id = p.id),
    'likedByMe', exists (select 1 from public.feed_reactions r where r.post_id = p.id and r.profile_id = p_uid),
    'commentCount', (select count(*) from public.feed_comments c where c.post_id = p.id),
    'attachments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id, 'path', a.storage_path, 'kind', a.kind, 'fileName', a.file_name,
        'mimeType', a.mime_type, 'sizeBytes', a.size_bytes, 'width', a.width, 'height', a.height
      ) order by a.position)
      from public.feed_attachments a where a.post_id = p.id
    ), '[]'::jsonb),
    'poll', (
      select jsonb_build_object(
        'question', pl.question,
        'multiple', pl.multiple,
        'voterCount', (select count(distinct v.profile_id) from public.feed_poll_votes v where v.post_id = p.id),
        'options', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', o.id,
            'label', o.label,
            'votes', (select count(*) from public.feed_poll_votes v where v.option_id = o.id),
            'mine', exists (select 1 from public.feed_poll_votes v where v.option_id = o.id and v.profile_id = p_uid)
          ) order by o.position)
          from public.feed_poll_options o where o.post_id = p.id
        ), '[]'::jsonb)
      )
      from public.feed_polls pl where pl.post_id = p.id
    )
  )
  from public.feed_posts p
  left join public.profiles pr on pr.id = p.author_id
  where p.id = p_post_id;
$$;

-- One page of the feed as JSON, pinned first on the first page. p_before: the
-- created_at of the last post already shown.
create or replace function public.list_feed(p_limit integer default 20, p_before timestamptz default null)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with me as (select public.feed_require_uid() as uid),
  page as (
    select p.*
    from public.feed_posts p
    where (p_before is null and p.pinned_at is not null)
       or (p.pinned_at is null and (p_before is null or p.created_at < p_before))
    order by (p.pinned_at is not null) desc, p.pinned_at desc nulls last, p.created_at desc
    limit least(greatest(coalesce(p_limit, 20), 1), 50)
  )
  select coalesce(jsonb_agg(public.feed_post_json(page.id, me.uid)
                            order by (page.pinned_at is not null) desc, page.pinned_at desc nulls last, page.created_at desc), '[]'::jsonb)
  from page, me;
$$;

create or replace function public.get_feed_post(p_post_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'post', public.feed_post_json(p_post_id, public.feed_require_uid()),
    'comments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id,
        'authorId', c.author_id,
        'authorName', coalesce(pr.full_name, 'Konto usunięte'),
        'body', c.body,
        'createdAt', c.created_at,
        'editedAt', c.edited_at,
        'mine', c.author_id = auth.uid()
      ) order by c.created_at)
      from public.feed_comments c
      left join public.profiles pr on pr.id = c.author_id
      where c.post_id = p_post_id
    ), '[]'::jsonb)
  );
$$;

-- Names for "who liked" / "who voted" (by surname in the client).
create or replace function public.feed_people(p_post_id uuid, p_option_id uuid default null)
returns table (full_name text)
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(pr.full_name, 'Konto usunięte')
  from (
    select r.profile_id from public.feed_reactions r
    where p_option_id is null and r.post_id = p_post_id and public.feed_require_uid() is not null
    union all
    select v.profile_id from public.feed_poll_votes v
    where p_option_id is not null and v.option_id = p_option_id and public.feed_require_uid() is not null
  ) people
  left join public.profiles pr on pr.id = people.profile_id;
$$;

-- ---------------------------------------------------------------- push

-- push_new_events (service_role): takes the posts not announced yet, marks them.
-- Posts older than a day are marked without announcing (e.g. after downtime).
create or replace function public.claim_feed_posts_for_push()
returns table (id uuid, author_id uuid, author_name text, body text, has_poll boolean, attachment_count integer, fresh boolean)
language sql
volatile
security definer
set search_path = public
as $$
  with claimed as (
    update public.feed_posts p
    set notified_at = now()
    where p.notified_at is null
    returning p.id, p.author_id, p.body, p.created_at
  )
  select c.id, c.author_id, coalesce(pr.full_name, ''), c.body,
         exists (select 1 from public.feed_polls pl where pl.post_id = c.id),
         (select count(*)::integer from public.feed_attachments a where a.post_id = c.id),
         c.created_at > now() - interval '1 day'
  from claimed c
  left join public.profiles pr on pr.id = c.author_id;
$$;

create or replace function public.set_push_topics(p_endpoint text, p_topics text[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.feed_require_uid();
begin
  if exists (select 1 from unnest(coalesce(p_topics, '{}')) t where t not in ('new_event', 'new_post')) then
    raise exception 'unknown_topic' using errcode = '22023';
  end if;
  update public.push_subscriptions
  set topics = coalesce(p_topics, '{}'), updated_at = now()
  where endpoint = trim(p_endpoint) and profile_id = v_uid;
end;
$$;

-- The caller's topics on this browser (null: not subscribed here).
create or replace function public.get_push_topics(p_endpoint text)
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select topics from public.push_subscriptions
  where endpoint = trim(p_endpoint) and profile_id = public.feed_require_uid();
$$;

-- ---------------------------------------------------------------- grants

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.create_feed_post(text, jsonb, jsonb)',
    'public.update_feed_post(uuid, text)',
    'public.delete_feed_post(uuid)',
    'public.set_feed_post_pinned(uuid, boolean)',
    'public.add_feed_comment(uuid, text)',
    'public.update_feed_comment(uuid, text)',
    'public.delete_feed_comment(uuid)',
    'public.toggle_feed_reaction(uuid)',
    'public.vote_feed_poll(uuid, uuid[])',
    'public.list_feed(integer, timestamptz)',
    'public.get_feed_post(uuid)',
    'public.feed_people(uuid, uuid)',
    'public.set_push_topics(text, text[])',
    'public.get_push_topics(text)'
  ]
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$$;

revoke all on function public.feed_post_json(uuid, uuid) from public, anon, authenticated;
revoke all on function public.feed_is_moderator(uuid) from public, anon, authenticated;
revoke all on function public.claim_feed_posts_for_push() from public, anon, authenticated;
grant execute on function public.claim_feed_posts_for_push() to service_role;
grant execute on function public.feed_require_uid() to authenticated;

-- ---------------------------------------------------------------- storage

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
