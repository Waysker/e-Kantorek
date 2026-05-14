# ORAGH V1 Component Checklist

## Purpose

Map the approved wireframes into reusable UI components before implementation starts.

This helps us avoid rebuilding the same patterns screen by screen.

## Priority Levels

- `P0`: required for the first usable build
- `P1`: still part of v1, but can land after the core flow works

## App Shell

### `AppShell`

Priority:

- `P0`

Responsibility:

- safe area handling
- top header slot
- content area
- mobile bottom nav or web sidebar

Used in:

- feed
- events
- profile

### `MobileBottomNav`

Priority:

- `P0`

Responsibility:

- bottom tabs for `Feed`, `Events`, `Profile`
- active state
- persistent bottom anchoring on standard app screens

Not used in:

- immersive setlist reader

### `WebSidebar`

Priority:

- `P0`

Responsibility:

- left-side navigation
- organization identity
- active section state

## Feed

### `FeedHeader`

Priority:

- `P0`

Responsibility:

- orchestra identity
- quiet `Write post` entry
- optional profile shortcut

### `FeedPostCard`

Priority:

- `P0`

Responsibility:

- author
- timestamp
- content preview
- optional metadata

Variants:

- standard
- pinned

### `FeedComposerEntry`

Priority:

- `P0`

Responsibility:

- small post-entry affordance
- opens composer flow

### `CommentItem`

Priority:

- `P1`

Responsibility:

- author
- timestamp
- body

### `CommentComposer`

Priority:

- `P1`

Responsibility:

- text entry
- submit action

## Events

### `EventListItem`

Priority:

- `P0`

Responsibility:

- date-first layout
- title
- venue or subtype
- attendance hint
- activity hint

### `EventHeaderCard`

Priority:

- `P0`

Responsibility:

- title
- date
- venue
- event metadata

### `EventUpdateBlock`

Priority:

- `P0`

Responsibility:

- official update author
- timestamp
- update body

Reuse rule:

- same structure on mobile and web

### `EventCommentList`

Priority:

- `P1`

Responsibility:

- comments under event
- empty state
- comment item reuse

## Attendance

### `AttendanceSummaryStrip`

Priority:

- `P0`

Responsibility:

- compact counts for `Going`, `Maybe`, `Not going`

Reuse rule:

- use in event detail
- use on dedicated attendance page
- use on web event rail
- use in squad composition header when helpful

### `AttendanceResponseSelector`

Priority:

- `P0`

Responsibility:

- select one of `Going`, `Maybe`, `Not going`
- reflect current state

### `AttendanceCard`

Priority:

- `P0`

Responsibility:

- event context
- response selector
- summary strip

## Setlist

### `SetlistPreviewCard`

Priority:

- `P0`

Responsibility:

- small clickable preview from event detail
- short text sneak peek
- entry point to full reader

### `SetlistReader`

Priority:

- `P1`

Responsibility:

- immersive full-screen reading mode
- black-and-white parsed text presentation
- fit mode when readable
- scroll mode when dense

V1 rule:

- prioritize readability over forcing the whole setlist onto one screen

## Squad Composition

### `SquadPreviewCard`

Priority:

- `P0`

Responsibility:

- small clickable preview from event detail
- compact attendance summary
- short grouped preview

### `SquadCompositionScreen`

Priority:

- `P1`

Responsibility:

- grouped roster by instrument
- confirmed attendees as primary content
- empty instrument sections when useful
- maybe or unassigned members as secondary content

## Profile

### `ProfileHeader`

Priority:

- `P0`

Responsibility:

- member identity
- organization context

### `SettingsList`

Priority:

- `P0`

Responsibility:

- notification preferences
- account basics
- sign-out

## Suggested Build Sequence

Implement these first:

1. `AppShell`
2. `MobileBottomNav`
3. `WebSidebar`
4. `FeedHeader`
5. `FeedPostCard`
6. `EventListItem`
7. `EventHeaderCard`
8. `EventUpdateBlock`
9. `AttendanceSummaryStrip`
10. `AttendanceResponseSelector`

Then add:

11. `SetlistPreviewCard`
12. `SquadPreviewCard`
13. `CommentItem`
14. `CommentComposer`
15. `AttendanceCard`
16. `SetlistReader`
17. `SquadCompositionScreen`
18. `ProfileHeader`
19. `SettingsList`

## Implementation Notes

- avoid building separate mobile and web component families unless behavior truly diverges
- keep feed, events, and profile on the same spacing and typography system
- treat the attendance summary strip as a shared primitive, not a one-off event widget
- treat setlist and squad as secondary event tools launched from event detail
