# ORAGH App Implementation Brief V1

## Purpose

Turn the approved wireframes into a buildable v1 for ORAGH.

This brief translates the current design baseline into:

- app sections
- routes
- roles and permissions
- core user flows
- implementation order

The goal is to start building without drifting back into earlier chat-first ideas.

## Working Product Shape

V1 is a private orchestra community app with three main sections:

- `Feed`
- `Events`
- `Profile`

Supporting event tools in v1:

- attendance survey
- setlist access
- squad composition derived from attendance and instrument

Chat is out of scope for this first release.

## Recommended Stack

### Frontend

- Expo
- React Native
- TypeScript
- Expo Router

Why:

- strong mobile path
- web support from the same codebase
- easy alignment with the existing mobile-first design system

### Backend

- Supabase

Why:

- authentication
- Postgres data model
- file storage for attachments if needed
- good fit for notifications and role-based access later

## Delivery Principle

Build mobile-first, but use shared routes and responsive layout rules so web is supported from the start.

The product should not become:

- a phone UI stretched onto desktop
- a forum product
- a chat application with feed added later

## Temporary Delivery Stage

Before the full backend exists, v1 can ship a visual prototype stage that reads from the current forum.

This stage is intentionally temporary.

Its purpose is:

- validate the real UI with real orchestra data
- reduce implementation risk before the full backend is ready
- let us test feed-and-events product behavior against real usage patterns

Its purpose is not:

- to make the forum the long-term backend
- to shape the app around forum-specific structures
- to accumulate new product logic on top of forum quirks

### Phase 0 Rule

Treat the forum as a temporary read-only source.

That means:

- read existing users, events, and attendance from the forum
- map them into ORAGH app models
- keep all parsing and transformation inside a dedicated adapter layer
- do not let screens or components depend on raw forum fields or markup

### Temporary Architecture Rule

The UI should depend on stable app-level models such as:

- `UserProfile`
- `FeedPost`
- `Event`
- `EventUpdate`
- `AttendanceSummary`
- `AttendanceResponse`
- `SetlistPreview`
- `SquadComposition`

The forum integration should sit behind interfaces such as:

- `FeedRepository`
- `EventsRepository`
- `AttendanceRepository`
- `UsersRepository`

Suggested temporary adapter:

- `ForumAdapter`

Suggested future adapter:

- `AppApiAdapter`

If we keep that boundary clean, swapping the data source later becomes an infrastructure change instead of a screen rewrite.

## App Sections And Routes

Suggested route map for Expo Router:

- `/feed`
- `/events`
- `/events/[eventId]`
- `/events/[eventId]/attendance`
- `/events/[eventId]/setlist`
- `/events/[eventId]/squad`
- `/profile`

Optional future routes, not part of first build:

- `/events/new`
- `/feed/new`
- `/admin`

## Navigation

### Mobile

Bottom navigation:

- `Feed`
- `Events`
- `Profile`

The bottom nav stays visible on standard app screens.

It should not appear inside the immersive mobile setlist reader.

### Web

Left-side navigation:

- `Feed`
- `Events`
- `Profile`

Use a centered reading column and only add a right-side panel when it provides real utility.

## Roles

### Member

Can:

- read feed posts
- create feed posts
- comment on feed posts
- read events
- comment on events
- respond to attendance
- open setlists
- open squad composition
- manage own profile and notification preferences

### Leader

Can do everything a member can, plus:

- create events
- edit events they manage
- post official event updates
- manage setlist content

### Admin

Can do everything a leader can, plus:

- manage membership and roles
- moderate content
- manage organization-level settings

## Core User Flows

### 1. Read Feed

1. User lands on `Feed`
2. User sees pinned and recent chronological posts
3. User opens a post or comments inline if supported

Success condition:

- the feed feels like the app front door

### 2. Create Feed Post

1. User taps the quiet `Write post` action
2. User creates a simple text-first post
3. Post appears in the chronological feed

V1 note:

- keep posting simple
- do not overbuild formatting or rich composer features

### 3. Browse Events

1. User opens `Events`
2. User scans upcoming items
3. User opens one event detail page

Success condition:

- the event list is faster to scan than the old forum workflow

### 4. Read Event Detail

The event detail page should combine:

- event header
- description
- official updates
- comments
- attendance entry point
- setlist preview
- squad composition preview

Success condition:

- a member can understand one event without jumping between multiple tools

### 5. Respond To Attendance

1. User opens the attendance block or dedicated attendance page
2. User chooses `Going`, `Maybe`, or `Not going`
3. Aggregate summary updates

Success condition:

- response takes seconds
- response can be changed later

### 6. Open Setlist

1. User taps the setlist preview from event detail
2. App opens a dedicated immersive reader
3. Reader shows parsed black-and-white setlist content
4. If readable on one screen, show fit mode
5. If too dense, keep readable type and scroll

Success condition:

- usable during rehearsal or concert

### 7. Open Squad Composition

1. User taps the squad composition preview from event detail
2. App opens a dedicated grouped roster page
3. Page groups confirmed attendees by instrument
4. Empty instrument groups remain visible when useful

Success condition:

- members can quickly understand coverage by section

## Core Reusable Components

The build should treat these as reusable system pieces:

- app shell
- mobile bottom nav
- web sidebar
- feed card
- pinned feed card variant
- event list item
- event header block
- official update block
- comment item
- comment composer
- attendance summary strip
- attendance response choice row
- setlist preview card
- squad composition preview card
- profile info row

## V1 Non-Goals

Do not expand scope into:

- chat
- advanced forum hierarchy
- score annotation tools
- ticketing
- payments
- audio or video features
- complex moderation dashboards

## Suggested Build Order

### Phase 0: Read-Only Forum Prototype

- scaffold the app shell
- build the core visual screens
- connect to forum data through a temporary adapter
- support read-only data loading for users, events, attendance, and any event-linked text content available there
- avoid write flows against the forum unless explicitly added later

Success condition:

- the app looks and behaves like the target product while reading realistic live data

### Phase 1: Foundation

- Expo app scaffold
- routing
- theme tokens
- shared shell
- auth bootstrap

### Phase 2: Feed

- feed read flow
- feed post composer
- feed comments

### Phase 3: Events

- events list
- event detail
- official updates
- event comments

### Phase 4: Attendance

- attendance submission
- attendance summary strip
- edit existing response

### Phase 5: Setlist And Squad

- setlist preview
- immersive setlist reader
- squad composition page derived from attendance and instruments

### Phase 6: Profile And Notifications

- profile basics
- notification preferences
- basic event and post notification handling

## Practical Assumptions

- v1 can launch for one orchestra organization first, while keeping the schema multi-organization friendly
- each user has one primary instrument in v1
- squad composition is derived, not manually edited
- setlist content starts as formatted text, not PDF upload
- event updates are authored posts tied to one event
- the first prototype can read from the current forum through a temporary adapter
- the forum integration should remain disposable and isolated from UI code

## Definition Of Done For V1

V1 is ready to test when:

- a member can sign in
- the member can read and create feed posts
- the member can browse events and open event detail
- organizers can publish event updates
- the member can submit and change attendance
- the member can open setlist preview and reader
- the member can open squad composition grouped by instrument
- the same app works on phone and web with intentional layout behavior
