-- Kantorek: history copied over from the Facebook group "Wirtualny kantorek"
-- (Partytura → Kantorek (feed) → History from Facebook). Board and admins add
-- posts by hand through import_feed_post; an imported post keeps the FB
-- author's name and date, belongs to no app account, has a closed poll with
-- the FB results and the FB like count, and never sends push.

alter table public.feed_posts
  add column if not exists source text not null default 'app' check (source in ('app', 'facebook')),
  add column if not exists external_author_name text check (char_length(external_author_name) <= 120),
  add column if not exists external_url text check (external_url is null or external_url ~ '^https://'),
  add column if not exists external_like_count integer not null default 0 check (external_like_count >= 0),
  add column if not exists imported_by uuid;

alter table public.feed_comments
  add column if not exists external_author_name text check (char_length(external_author_name) <= 120);

alter table public.feed_polls
  add column if not exists closed boolean not null default false;

alter table public.feed_poll_options
  add column if not exists external_votes integer not null default 0 check (external_votes >= 0);

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
    'authorName', coalesce(p.external_author_name, pr.full_name, 'Konto usunięte'),
    'body', p.body,
    'createdAt', p.created_at,
    'editedAt', p.edited_at,
    'pinned', p.pinned_at is not null,
    'mine', coalesce(p.author_id = p_uid, false),
    'source', p.source,
    'externalUrl', p.external_url,
    'likeCount', p.external_like_count + (select count(*) from public.feed_reactions r where r.post_id = p.id),
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
        'closed', pl.closed,
        'voterCount', (select count(distinct v.profile_id) from public.feed_poll_votes v where v.post_id = p.id)
                      + case when pl.closed
                             then (select coalesce(sum(o.external_votes), 0) from public.feed_poll_options o where o.post_id = p.id)
                             else 0 end,
        'options', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', o.id,
            'label', o.label,
            'votes', o.external_votes + (select count(*) from public.feed_poll_votes v where v.option_id = o.id),
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
        'authorName', coalesce(c.external_author_name, pr.full_name, 'Konto usunięte'),
        'body', c.body,
        'createdAt', c.created_at,
        'editedAt', c.edited_at,
        'mine', coalesce(c.author_id = auth.uid(), false)
      ) order by c.created_at)
      from public.feed_comments c
      left join public.profiles pr on pr.id = c.author_id
      where c.post_id = p_post_id
    ), '[]'::jsonb)
  );
$$;

-- ---------------------------------------------------------------- writing

-- The board may also correct imported posts (they belong to no account).
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
  where id = p_post_id
    and (author_id = v_uid or (source = 'facebook' and public.feed_is_moderator(v_uid)));
  if not found then
    raise exception 'not_your_post' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.vote_feed_poll(p_post_id uuid, p_option_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.feed_require_uid();
  v_multiple boolean;
  v_closed boolean;
  v_valid integer;
  v_wanted integer := coalesce(cardinality(p_option_ids), 0);
begin
  select multiple, closed into v_multiple, v_closed from public.feed_polls where post_id = p_post_id;
  if not found then
    raise exception 'no_poll' using errcode = '22023';
  end if;
  if v_closed then
    raise exception 'poll_closed' using errcode = '22023';
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

-- p: {
--   "authorName": "Ania Raczkowska", "createdAt": "2026-10-21T18:40:00+02:00",
--   "body": "...", "externalUrl": "https://www.facebook.com/...", "likeCount": 13,
--   "attachments": [ same shape as create_feed_post ],
--   "poll": {"question": "...", "multiple": false, "options": [{"label": "PRL", "votes": 24}]},
--   "comments": [{"authorName": "...", "body": "...", "createdAt": "..."}]
-- }
create or replace function public.import_feed_post(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.feed_require_uid();
  v_post uuid;
  v_created timestamptz;
  v_author text := left(trim(coalesce(p ->> 'authorName', '')), 120);
  v_body text := trim(coalesce(p ->> 'body', ''));
  v_options jsonb := p -> 'poll' -> 'options';
  v_attachment jsonb;
  v_comment jsonb;
  v_index integer := 0;
begin
  if not public.feed_is_moderator(v_uid) then
    raise exception 'only_board' using errcode = '42501';
  end if;
  if v_author = '' then
    raise exception 'author_required' using errcode = '22023';
  end if;
  begin
    v_created := (p ->> 'createdAt')::timestamptz;
  exception when others then
    v_created := null;
  end;
  if v_created is null or v_created > now() + interval '1 day' then
    raise exception 'invalid_date' using errcode = '22023';
  end if;
  if jsonb_array_length(coalesce(p -> 'attachments', '[]'::jsonb)) > 6 then
    raise exception 'too_many_attachments' using errcode = '22023';
  end if;
  if v_body = '' and p -> 'poll' is null and jsonb_array_length(coalesce(p -> 'attachments', '[]'::jsonb)) = 0 then
    raise exception 'empty_post' using errcode = '22023';
  end if;

  insert into public.feed_posts (
    author_id, body, created_at, notified_at, source, external_author_name, external_url,
    external_like_count, imported_by
  ) values (
    null, v_body, v_created, now(), 'facebook', v_author, nullif(trim(p ->> 'externalUrl'), ''),
    greatest(coalesce((p ->> 'likeCount')::integer, 0), 0), v_uid
  ) returning id into v_post;

  if p -> 'poll' is not null and jsonb_typeof(p -> 'poll') = 'object' then
    if jsonb_typeof(v_options) <> 'array' or jsonb_array_length(v_options) not between 2 and 10 then
      raise exception 'poll_needs_2_to_10_options' using errcode = '22023';
    end if;
    insert into public.feed_polls (post_id, question, multiple, closed)
    values (v_post, trim(p -> 'poll' ->> 'question'), coalesce((p -> 'poll' ->> 'multiple')::boolean, false), true);
    insert into public.feed_poll_options (post_id, position, label, external_votes)
    select v_post, ordinality::integer, trim(value ->> 'label'), greatest(coalesce((value ->> 'votes')::integer, 0), 0)
    from jsonb_array_elements(v_options) with ordinality;
  end if;

  for v_attachment in select value from jsonb_array_elements(coalesce(p -> 'attachments', '[]'::jsonb))
  loop
    v_index := v_index + 1;
    if split_part(v_attachment ->> 'path', '/', 1) <> v_uid::text then
      raise exception 'attachment_not_yours' using errcode = '42501';
    end if;
    insert into public.feed_attachments (
      post_id, position, storage_path, kind, file_name, mime_type, size_bytes, width, height
    ) values (
      v_post, v_index, v_attachment ->> 'path', coalesce(v_attachment ->> 'kind', 'file'),
      left(coalesce(nullif(trim(v_attachment ->> 'fileName'), ''), 'plik'), 200),
      v_attachment ->> 'mimeType', (v_attachment ->> 'sizeBytes')::integer,
      (v_attachment ->> 'width')::integer, (v_attachment ->> 'height')::integer
    );
  end loop;

  v_index := 0;
  for v_comment in select value from jsonb_array_elements(coalesce(p -> 'comments', '[]'::jsonb))
  loop
    v_index := v_index + 1;
    if trim(coalesce(v_comment ->> 'body', '')) = '' then
      continue;
    end if;
    insert into public.feed_comments (post_id, author_id, external_author_name, body, created_at)
    values (
      v_post, null,
      left(coalesce(nullif(trim(v_comment ->> 'authorName'), ''), 'Ktoś z Facebooka'), 120),
      trim(v_comment ->> 'body'),
      -- Without a date, comments keep their order just after the post.
      coalesce(nullif(v_comment ->> 'createdAt', '')::timestamptz, v_created + make_interval(mins => v_index))
    );
  end loop;

  return v_post;
end;
$$;

revoke all on function public.import_feed_post(jsonb) from public, anon;
grant execute on function public.import_feed_post(jsonb) to authenticated;
