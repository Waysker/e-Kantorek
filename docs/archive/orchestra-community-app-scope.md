# Orchestra Community App Scope

## Product Goal

Build a private community app for orchestra members where the main experience is a chronological community feed and the most important structured content lives in event pages.

The product should feel like a calm digital home for ORAGH:

- useful for everyday communication
- clear enough for official organization updates
- comfortable on phones
- fully workable on the web

This is not a chat-first product and it should not feel like a generic messaging app.

## Core Product Model

### Feed

The feed is the front door of the app.

Anyone in the organization can post to it.

Typical feed content:

- organization posts about upcoming dates and events
- surveys and calls for responses
- party or trip descriptions
- pinned reminders when needed
- informal or off-topic community posts

Rules:

- posts are shown chronologically
- some posts may be pinned
- posting stays available to everyone, but the create action should remain visually quiet

### Events

Events are structured, dated topics that replace the older forum-style workflow.

An event usually represents one concrete rehearsal, concert, workshop, trip, or organization occasion.

Typical event examples:

- `20 Mar 2026 Concert at X Hall`
- `4 Dec 2026 Barborka`
- `12 Jan 2027 Warsztaty`

Each event detail should include:

- title
- date
- optional venue
- main description
- official updates with authors
- comments from members
- attendance survey
- setlist or score references
- squad composition access

The event page should feel like one coherent topic, not a classic category-based forum thread.

### Attendance Survey

Attendance is part of the event flow in v1.

Each event should support a simple response pattern such as:

- going
- maybe
- not going

The response summary should be easy to scan on both mobile and web.

Assume each user has an instrument property.

That lets the product generate a practical event roster from confirmed attendance.

### Squad Composition

Squad composition is a derived event view built from:

- users marked as `going`
- each member's instrument property

Recommended behavior:

- event detail shows only a small clickable preview
- tapping the preview opens a dedicated grouped roster page
- the main grouping should show confirmed members by instrument
- `maybe`, `not going`, or missing responses can appear as clearly secondary information

### Setlist

Setlists are important, but they should not dominate the mobile event page.

Recommended behavior:

- mobile: show a small clickable preview or sneak peek in the event page
- mobile: tapping the preview opens a dedicated full-screen reader, similar to opening a document or PDF inside the app
- mobile reader: use a black-and-white presentation that feels like a page, not a normal app card
- mobile reader: fit the whole setlist only when it stays readable, otherwise keep readable type and allow scrolling
- web: allow setlist to remain visible in a side panel when space allows

## Primary Users

- Members: read the feed, reply to events, confirm attendance, check setlists
- Organizers and leaders: publish official posts, create events, publish updates, track responses
- Admins: manage membership, permissions, and moderation

## Supported Platforms

### V1

Support both:

- mobile app layouts
- responsive web layouts

This should be treated as one product system, not a phone-only design stretched later.

### Layout Principle

- mobile is still the primary layout constraint
- web should get purpose-built structure such as side navigation and side panels where useful

## Core V1 Scope

### 1. Identity and Membership

- private organization access
- invite-based or admin-managed membership
- member, leader, and admin roles

### 2. Feed

- chronological post stream
- support for pinned posts
- lightweight posting flow
- comments or reply entry points where needed

### 3. Events

- event list
- event detail
- authored official updates
- comments
- attachments or score references
- setlist access

### 4. Attendance

- per-event attendance response
- clear counts and summary state
- easy response changes
- derived squad composition from confirmed responses and member instruments

### 5. Notifications

At minimum, the product should support notification logic for:

- new official event updates
- important feed posts
- attendance or event reminders

### 6. Profile and Basic Settings

- member identity basics
- notification preferences
- sign-out

## Out Of Scope For V1

- chat as a primary product area
- forum-style category navigation
- separate notes section as a core navigation item
- audio or video calling
- advanced sheet music tooling
- ticketing or payments

Chat may return later as a secondary coordination tool, but it is not part of the current v1 scope.

## Information Architecture

### Mobile

Top-level navigation should center on:

- Feed
- Events
- Profile

### Web

Use the same product sections, but adapt the shell for larger screens:

- left sidebar navigation
- centered main reading area
- optional right-side panels only when they add real utility

## Interaction Principles

- Feed should feel open and lightweight
- Event pages should feel structured and dependable
- Official updates should be visually distinct without becoming a separate bulky section
- The interface should stay calm and not over-explain where the user is

## Visual Direction

Current working direction:

- based loosely on AGH colors
- adapted into a warmer ORAGH-specific product language
- contemporary, readable typography
- more cultural/community than institutional portal

This direction is intentionally adjustable as the product evolves.

## Recommended Technical Direction

### Frontend

- Expo + React Native + TypeScript

Why:

- strong mobile path
- responsive web support through the same stack
- good fit for a shared design system

### Backend

- Supabase

Why:

- good fit for auth, structured event content, feed content, attachments, and notifications

## Suggested Core Data Model

- `users`
- `organizations`
- `memberships`
- `feed_posts`
- `feed_comments`
- `events`
- `event_updates`
- `event_comments`
- `attendance_responses`
- `user_instruments` or an equivalent primary instrument field on `users`
- `attachments`
- `setlists`
- `notifications`
- `notification_preferences`
- `devices`

## MVP Release Checklist

- members can securely access the private organization
- the feed works well on phone and web
- organizers can publish events
- members can read event details and updates
- members can respond to attendance surveys
- event squad composition can be derived from attendance and instrument data
- setlists are accessible in a practical way
- important notifications can be delivered

## Immediate Next Actions

1. Keep the design docs and wireframes aligned with the feed-and-events model.
2. Continue high-fidelity work on `Events / List`, `Events / Detail`, and attendance patterns.
3. Push the approved design baseline into Figma once the next review round is ready.
