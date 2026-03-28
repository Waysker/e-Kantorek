# Visual Direction Kickoff

## Short Answer

Yes. We should keep using mock pages and layouts to define the product visually, but the visual direction now needs to serve the feed-and-events model rather than a chat-first app.

The right approach is:

- keep the approved feed-first structure
- define and refine one working visual direction
- maintain a small design system as we go
- apply changes to real anchor screens instead of debating palette in isolation

## Current Product Shape

The product is centered on:

- Feed as the main page
- Events as dated structured topics
- Attendance survey inside event flow
- Responsive web support from the start

Chat is out of the current v1 scope.

## Recommended Design Workflow

### 1. Keep low-fidelity structure stable

At this stage, focus on:

- feed hierarchy
- event hierarchy
- mobile and web adaptation
- attendance flow
- setlist access patterns

Do not keep redesigning the information architecture while exploring visuals.

### 2. Evolve one visual direction

After the structure is stable, define and refine:

- color palette
- typography
- spacing scale
- corner radius style
- icon style
- card and surface style

### 3. Apply changes to anchor screens

Use a small set of real screens to judge the system:

- Feed / Home / Small
- Feed / Home / Web
- Events / Detail / Small

### 4. Keep a small system page in sync

Define reusable tokens and components:

- colors
- type scale
- spacing
- buttons
- chips
- cards
- update blocks
- attendance patterns

### 5. Prototype key flows

Prototype:

- browse feed
- open event
- respond to attendance survey
- open setlist

## What We Should Reuse Instead Of Reinventing

### Navigation Patterns

Use standard patterns:

- bottom tabs for mobile
- side navigation for web
- stack navigation for drill-in flows
- compact actions for secondary tasks

Recommended top-level sections for v1:

- Feed
- Events
- Profile

### Form Patterns

Use standard interaction patterns for:

- sign in
- attendance choice
- comments
- settings

### Event Patterns

Reuse proven list-detail patterns:

- event list with date and metadata
- structured detail page
- comments under main content
- utility information off to the side on web when helpful

## Industry Standards To Follow

### Platform Standards

- Apple Human Interface Guidelines
- Material Design 3

We should use them for behavior and ergonomics, not as a full brand template.

### Accessibility Standard

Use WCAG 2.2 AA as the baseline.

That affects:

- text contrast
- font scaling
- touch target size
- focus order
- clear labels

## Current Working Visual Direction

The current direction is `ORAGH Warmer Cultural`.

It is based on the AGH palette as a starting point, but it is not meant to feel like a strict university admin portal.

Working principles:

- AGH green as the core brand anchor
- restrained use of AGH red
- warmer neutral surfaces around the brand colors
- contemporary sans typography rather than an editorial serif mood
- calm, structured hierarchy

This direction is intentionally still adjustable.

## What The Product Should Feel Like

- calm
- organized
- warm
- credible
- community-led

It should not feel like:

- a gaming chat app
- a corporate intranet
- a newspaper or magazine layout

## First Screens To Keep Reviewing

These are the highest-value review screens:

- Feed / Home / Small
- Feed / Home / Web
- Events / Detail / Small
- Events / List / Small
- Events / Detail / Web
- Events / Attendance / Small

## Suggested Deliverables

### Current Round

- stable low-fi wireframes
- one working visual direction
- high-fi anchor screens
- components and tokens page

### Next Round

- refined event list
- refined attendance state patterns
- setlist reader screen
- refreshed Figma review baseline

## Practical Rule For This Project

Use standards for:

- navigation
- controls
- spacing logic
- accessibility

Customize for brand in:

- color
- typography
- surfaces
- emphasis
- content tone

## Best Next Step

Keep the docs, wireframes, and Figma baseline synchronized.

That is more valuable right now than expanding scope, because the product direction is finally coherent enough to refine rather than reframe.
