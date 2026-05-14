# Wireframe Screen Inventory

## Goal

This document defines the current wireframe scope for the ORAGH community app.

These screens are enough to validate:

- feed-first navigation
- event structure
- attendance flow
- mobile and web layout logic

## Primary Navigation

Top-level sections for v1:

- Feed
- Events
- Profile

Chat is intentionally out of the current v1 wireframe scope.

## Screen 1: Feed / Home / Small

Purpose:

- make the community feed the clear front door

Must include:

- orchestra identity in the header
- quiet post creation entry point
- pinned and unpinned feed examples
- realistic chronological posts
- light metadata such as author and time
- bottom navigation

Questions this screen answers:

- Does the feed feel like the main page?
- Is posting available without dominating the screen?

## Screen 2: Feed / Home / Web

Purpose:

- prove the feed works as a proper web layout, not just a stretched phone

Must include:

- left-side navigation
- centered feed column
- clear hierarchy for pinned and normal posts
- restrained header treatment

Questions this screen answers:

- Does the product still feel focused on desktop?
- Is the web shell simpler and stronger than a phone clone?

## Screen 3: Events / List / Small

Purpose:

- show upcoming and relevant events in a clear, scan-friendly list

Must include:

- date-forward event rows or cards
- title
- optional venue or label
- attendance status hint
- activity hint such as updates or comments

Questions this screen answers:

- Can members quickly find the event they need?
- Does this feel modern without becoming a forum UI?

## Screen 4: Events / Detail / Small

Purpose:

- support one event as a structured topic page on mobile

Must include:

- title and date
- main event description
- official updates merged naturally into the main event area
- author on each update
- comments section
- attendance survey block
- small clickable setlist preview or sneak peek
- setlist entry point to a dedicated full-screen view
- small clickable squad composition preview
- squad composition entry point to a dedicated grouped roster view

Questions this screen answers:

- Does one event feel organized and dependable?
- Are updates distinct without needing a bulky extra header?

## Screen 5: Events / Detail / Web

Purpose:

- adapt the structured event page for larger screens

Must include:

- left sidebar navigation
- main event content area
- inline official updates
- comments
- right-side utility area only where it adds value
- visible plain-text setlist
- visible attendance block

Questions this screen answers:

- Does web use space meaningfully?
- Are setlist and attendance easier to scan on desktop?

## Screen 6: Events / Attendance / Small

Purpose:

- make attendance response easy and obvious on mobile

Must include:

- event context
- response choices
- current response state
- simple aggregate counts

Questions this screen answers:

- Can members answer in seconds?
- Is the status summary clear enough without extra explanation?

## Screen 7: Setlist / Small

Purpose:

- give members a focused formatted-text view for concert or rehearsal use

Preferred review variants:

- `Setlist / Small / Fit`
- `Setlist / Small / Scroll`

Must include:

- event reference
- clear sense that this is opened from the event page
- black-and-white full-screen presentation
- parsed setlist structure from the source post
- strong readability
- minimal distractions
- fit the whole setlist on screen only when it remains readable
- never reduce text size so far that concert reading becomes uncomfortable
- scroll when the content becomes too dense to fit comfortably

Questions this screen answers:

- Is the setlist practical during live use?
- Does opening it feel like a focused full-screen document rather than just another ordinary app subpage?
- Does it feel closer to a book page or document view than to regular in-app content?
- Does this feel lighter than embedding a large block in the event page?
- Does the fit-versus-scroll rule protect readability instead of forcing everything into one screen?

## Screen 8: Squad Composition / Small

Purpose:

- give members and organizers a quick roster view built from attendance and instrument data

Must include:

- event reference
- grouping by instrument
- confirmed attendees as the primary list
- empty sections shown clearly when needed
- maybe or missing responses as secondary context if present

Questions this screen answers:

- Can we see section coverage quickly before the event?
- Does this feel like a practical roster page rather than another discussion screen?

## Screen 9: Profile / Settings

Purpose:

- give members a simple place for account basics

Must include:

- profile identity
- organization context
- notification settings
- sign-out

## Important States To Mock

Do not only mock happy paths.

Also mock:

- empty feed
- empty events list
- no upcoming events
- closed or archived event
- attendance already submitted
- no setlist available
- short setlist that fits on one screen
- longer setlist that keeps readable type and scrolls
- empty instrument section such as `Flety --`
- member without instrument assignment

## Suggested Mocking Order

Create these first:

1. Feed / Home / Small
2. Events / Detail / Small
3. Feed / Home / Web
4. Events / List / Small
5. Events / Detail / Web
6. Events / Attendance / Small
7. Setlist / Small
8. Squad Composition / Small
9. Profile / Settings

## Rule For Mock Fidelity

Use low fidelity for:

- navigation
- layout blocks
- hierarchy
- flow

Use high fidelity only after:

- feed and event structure feel right
- mobile and web both make sense
- content density feels comfortable

## Deliverable Format

Each key screen should have:

- one low-fi version
- one notes panel explaining purpose and key actions
- one mobile frame where relevant
- one web variant where relevant

Optional later:

- tablet adaptations
- chat reintroduction as a future phase
- admin-only event management views
