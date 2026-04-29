# ORAGH V1 Data Model

## Goal

Define an initial backend schema for the approved v1 scope:

- private membership
- feed
- events
- attendance
- setlists
- squad composition
- profile basics

This is an implementation-facing starting point, not a locked final database.

## Modeling Principles

- keep the schema multi-organization friendly
- keep v1 content text-first
- derive squad composition instead of storing it separately
- make attendance updates idempotent with one response per user per event
- allow web and mobile to consume the same content model

## Temporary Legacy Forum Adapter

Before the real backend is implemented, the app may read existing content from the current forum.

That integration should be treated as a temporary adapter, not as part of the long-term domain model.

Rules:

- parse forum data into ORAGH app models before it reaches the UI
- do not expose raw forum response shapes directly to screens
- do not encode forum naming, IDs, or formatting assumptions into reusable components
- do not treat the temporary forum source as the future schema

Suggested internal app models for the prototype:

- `UserProfile`
- `Event`
- `EventUpdate`
- `AttendanceSummary`
- `AttendanceResponse`
- `Setlist`
- `SquadComposition`

The real database should still be designed around the canonical tables below, even if the first prototype reads from another source.

## Core Tables

### `organizations`

Purpose:

- top-level organization record

Suggested fields:

- `id` uuid primary key
- `name` text not null
- `short_name` text
- `slug` text unique
- `created_at` timestamptz not null default now()

### `users`

Purpose:

- application user profile

Suggested fields:

- `id` uuid primary key
- `email` text unique not null
- `full_name` text not null
- `display_name` text
- `avatar_url` text
- `primary_instrument` text
- `is_active` boolean not null default true
- `created_at` timestamptz not null default now()
- `updated_at` timestamptz not null default now()

V1 note:

- one primary instrument per user is enough for the first release

### `memberships`

Purpose:

- connect users to organizations and roles

Suggested fields:

- `id` uuid primary key
- `organization_id` uuid not null references `organizations(id)`
- `user_id` uuid not null references `users(id)`
- `role` text not null
- `joined_at` timestamptz not null default now()

Suggested role values:

- `member`
- `leader`
- `admin`

Constraint:

- unique (`organization_id`, `user_id`)

### `feed_posts`

Purpose:

- chronological community feed content

Suggested fields:

- `id` uuid primary key
- `organization_id` uuid not null references `organizations(id)`
- `author_user_id` uuid not null references `users(id)`
- `kind` text not null
- `title` text
- `body` text not null
- `is_pinned` boolean not null default false
- `pinned_until` timestamptz
- `comments_enabled` boolean not null default true
- `created_at` timestamptz not null default now()
- `updated_at` timestamptz not null default now()
- `deleted_at` timestamptz

Suggested kind values:

- `general`
- `announcement`
- `survey`
- `social`
- `trip`
- `offtopic`

### `feed_comments`

Purpose:

- comments on feed posts

Suggested fields:

- `id` uuid primary key
- `feed_post_id` uuid not null references `feed_posts(id)`
- `author_user_id` uuid not null references `users(id)`
- `body` text not null
- `created_at` timestamptz not null default now()
- `updated_at` timestamptz not null default now()
- `deleted_at` timestamptz

### `events`

Purpose:

- structured dated topics

Suggested fields:

- `id` uuid primary key
- `organization_id` uuid not null references `organizations(id)`
- `created_by_user_id` uuid not null references `users(id)`
- `title` text not null
- `slug` text
- `event_type` text
- `status` text not null default 'published'
- `venue` text
- `starts_at` timestamptz not null
- `ends_at` timestamptz
- `attendance_deadline_at` timestamptz
- `body` text not null
- `created_at` timestamptz not null default now()
- `updated_at` timestamptz not null default now()
- `archived_at` timestamptz

Suggested event type values:

- `concert`
- `rehearsal`
- `workshop`
- `trip`
- `meeting`
- `other`

Suggested status values:

- `draft`
- `published`
- `archived`
- `cancelled`

### `event_updates`

Purpose:

- official authored updates attached to one event

Suggested fields:

- `id` uuid primary key
- `event_id` uuid not null references `events(id)`
- `author_user_id` uuid not null references `users(id)`
- `body` text not null
- `created_at` timestamptz not null default now()
- `updated_at` timestamptz not null default now()
- `deleted_at` timestamptz

V1 rule:

- these are official updates, not generic comments

### `event_comments`

Purpose:

- member discussion under one event

Suggested fields:

- `id` uuid primary key
- `event_id` uuid not null references `events(id)`
- `author_user_id` uuid not null references `users(id)`
- `body` text not null
- `created_at` timestamptz not null default now()
- `updated_at` timestamptz not null default now()
- `deleted_at` timestamptz

### `attendance_responses`

Purpose:

- one attendance response per user per event

Suggested fields:

- `id` uuid primary key
- `event_id` uuid not null references `events(id)`
- `user_id` uuid not null references `users(id)`
- `status` text not null
- `note` text
- `responded_at` timestamptz not null default now()
- `updated_at` timestamptz not null default now()

Suggested status values:

- `going`
- `maybe`
- `not_going`

Constraint:

- unique (`event_id`, `user_id`)

### `setlists`

Purpose:

- formatted text content for event setlists

Suggested fields:

- `id` uuid primary key
- `event_id` uuid not null references `events(id)`
- `updated_by_user_id` uuid not null references `users(id)`
- `source_format` text not null default 'formatted_text'
- `source_body` text not null
- `parsed_body_json` jsonb
- `created_at` timestamptz not null default now()
- `updated_at` timestamptz not null default now()

Constraint:

- unique (`event_id`)

V1 note:

- keep one active setlist per event
- parse from text for reader display

### `attachments`

Purpose:

- optional file links for events or feed content

Suggested fields:

- `id` uuid primary key
- `organization_id` uuid not null references `organizations(id)`
- `owner_type` text not null
- `owner_id` uuid not null
- `uploaded_by_user_id` uuid not null references `users(id)`
- `label` text
- `file_path` text not null
- `mime_type` text
- `created_at` timestamptz not null default now()

Suggested owner type values:

- `feed_post`
- `event`
- `setlist`

### `notification_preferences`

Purpose:

- basic user notification settings

Suggested fields:

- `id` uuid primary key
- `user_id` uuid not null references `users(id)`
- `push_feed_posts` boolean not null default true
- `push_event_updates` boolean not null default true
- `push_event_reminders` boolean not null default true
- `push_attendance_reminders` boolean not null default true
- `created_at` timestamptz not null default now()
- `updated_at` timestamptz not null default now()

Constraint:

- unique (`user_id`)

### `devices`

Purpose:

- store push-capable client devices

Suggested fields:

- `id` uuid primary key
- `user_id` uuid not null references `users(id)`
- `platform` text not null
- `push_token` text not null
- `last_seen_at` timestamptz
- `created_at` timestamptz not null default now()
- `updated_at` timestamptz not null default now()

### `notifications`

Purpose:

- app notification records

Suggested fields:

- `id` uuid primary key
- `user_id` uuid not null references `users(id)`
- `kind` text not null
- `title` text not null
- `body` text not null
- `ref_type` text
- `ref_id` uuid
- `read_at` timestamptz
- `created_at` timestamptz not null default now()

Suggested kind values:

- `feed_post`
- `event_update`
- `attendance_reminder`
- `event_reminder`

## Derived Views

### `event_attendance_summary`

Purpose:

- give the UI a compact count summary

Suggested shape:

- `event_id`
- `going_count`
- `maybe_count`
- `not_going_count`
- `no_response_count`

Implementation note:

- `no_response_count` can be derived from organization membership minus explicit responses

### `event_squad_composition`

Purpose:

- grouped roster view for one event

Suggested shape:

- `event_id`
- `instrument`
- `member_count`
- `members` jsonb

Rules:

- build primarily from `attendance_responses.status = 'going'`
- group by `users.primary_instrument`
- keep empty or unassigned states visible in the UI when needed

## Access Rules

Recommended v1 permissions:

- members can read all organization feed posts and events
- members can create feed posts and comments
- members can create and update their own attendance response
- members can create event comments
- leaders and admins can create or edit events
- leaders and admins can create official event updates
- leaders and admins can edit setlists
- admins can manage memberships and roles

## Suggested Indexes

Add indexes early for the main reads:

- `feed_posts (organization_id, is_pinned, created_at desc)`
- `feed_comments (feed_post_id, created_at asc)`
- `events (organization_id, starts_at asc)`
- `event_updates (event_id, created_at desc)`
- `event_comments (event_id, created_at asc)`
- `attendance_responses (event_id, status)`
- `notifications (user_id, read_at, created_at desc)`

## Open Implementation Notes

- decide whether `primary_instrument` stays as text in `users` or becomes a normalized lookup table later
- decide whether event comments should support threading in a later phase
- decide whether attachments need a dedicated join table if multiple attachment targets become common
- decide whether setlist parsing happens on write, on read, or both
- decide what forum fields map into canonical event, attendance, and user models during the read-only prototype phase
