# Figma First Screens Brief

## Goal

This brief defines the first two anchor screens to create and maintain in Figma:

- Feed / Home
- Events / Detail

These screens establish the product's core visual grammar for:

- hierarchy
- spacing
- content density
- official versus community content
- mobile and web adaptation

## General Setup

Create these frames first:

- `WF / Feed / Home / Small`
- `WF / Feed / Home / Web`
- `WF / Events / Detail / Small`
- `WF / Events / Detail / Web`

Recommended base widths:

- Small phone: 390 px
- Large phone if needed: 430 px
- Web content canvas: flexible desktop frame with sidebar structure

Keep the first pass low fidelity:

- grayscale surfaces
- simple labels
- placeholder avatars
- basic icons only

## Screen 1: Feed / Home

### Screen Purpose

Help a member quickly answer:

- What is happening now?
- What should I read first?
- How do I post something if I need to?

### Layout Structure

The screen should include these vertical sections in order:

1. Top safe area or desktop header region
2. Compact identity-led header
3. Feed stream
4. Bottom tabs on mobile or sidebar navigation on web

### Header Content

Use the orchestra identity rather than a generic oversized page title.

Suggested content:

- `Orkiestra Reprezentacyjna AGH`
- a quiet `Write post` action
- optional profile avatar or settings entry

The create action should stay visible but visually secondary.

### Feed Content

Use realistic mixed content such as:

- event announcement
- attendance survey teaser
- party description
- trip details
- off-topic post

Each post should show:

- author
- time
- concise content preview
- optional pinned treatment

### What This Screen Must Prove

- the feed clearly feels like the front door
- pinned items do not overpower normal posts
- post creation is available without dominating the layout

## Screen 2: Events / Detail

### Screen Purpose

Help a member understand one event fully and act on it quickly.

### Layout Structure

The screen should include:

1. Event header block
2. Main description
3. Inline official updates
4. Comments or discussion area
5. Attendance survey
6. Setlist access
7. Squad composition access

### Event Header

Suggested content:

- title
- date
- optional venue
- short supporting metadata

Example titles:

- `20 Mar 2026 Concert at X Hall`
- `4 Dec 2026 Barborka`
- `12 Jan 2027 Warsztaty`

### Official Updates

Official updates should be part of the main event area, not a large separate section.

Each update should show:

- author
- time
- concise update body

### Attendance Survey

Include a compact response pattern such as:

- `Going`
- `Maybe`
- `Not going`

Also show a simple summary count.

Assume each user has a primary instrument property.

That allows the event flow to expose a separate squad-composition view derived from confirmed attendance.

### Setlist

Treat setlist differently by platform:

- mobile: a small clickable preview inside the event page
- mobile: tapping the preview opens a dedicated full-screen reader, similar to a document or PDF view
- mobile reader: use a black-and-white page-like presentation instead of the regular app styling
- web: visible plain text in a side area when helpful

Assume the source is a formatted text post rather than a static image.

Reader rule:

- try to show the whole setlist on one screen only when the text remains comfortably readable
- never shrink the text below a comfortable reading size just to avoid scrolling
- if the content becomes denser, keep the type readable and let the page scroll

Preferred parsing behavior:

- preserve section headings
- preserve numbered items
- preserve short inline notes where useful
- remove unnecessary decorative formatting
- review both `Fit` and `Scroll` variants so the switching rule is visible in the design system

### What This Screen Must Prove

- one event can hold both official updates and community replies cleanly
- attendance is clear and lightweight
- the setlist pattern feels practical rather than decorative
- squad composition can be reached quickly without crowding the main event page

## Shared Visual Rules For Both Screens

Keep these consistent:

- same horizontal rhythm
- same card logic
- same typography hierarchy
- same navigation rules
- same brand tone

## Content Tone

Use placeholder content that feels real for orchestra life:

- concert logistics
- rehearsal timing
- attendance confirmation
- transport or trip details
- score or setlist references

Avoid generic product copy.

## Review Checklist

Before moving forward, confirm:

- the feed feels open and calm
- event detail feels structured, not forum-like
- mobile and web both feel intentional
- official updates are visible without adding clutter
- attendance is easy to understand at a glance

## Best Next Action

In Figma, keep these as the core baseline frames:

1. `WF / Feed / Home / Small`
2. `WF / Feed / Home / Web`
3. `WF / Events / Detail / Small`
4. `WF / Events / Detail / Web`

After that, extend the same system into:

- `WF / Events / List / Small`
- `WF / Events / Attendance / Small`
- `WF / Squad Composition / Small`
- `WF / Setlist / Small / Fit`
- `WF / Setlist / Small / Scroll`
