# Figma Workspace Brief

## Decision

We will use Figma for:

- wireframes
- visual exploration
- responsive layout review
- component definitions
- developer handoff

## Goal

Set up a Figma workspace that helps us move from rough wireframes to implementation without repeatedly redesigning the same feed and event flows.

## Official Libraries To Enable

Use official UI kits before pulling from general community templates.

Enable these in Figma from the `Assets` tab through `Libraries`:

- Apple iOS and iPadOS UI kit
- Material 3 Design Kit by Google

How we should use them:

- use them for controls, spacing logic, and behavioral patterns
- do not copy their full visual language directly
- keep the ORAGH brand layer separate

## Recommended Figma File Structure

Create one main Figma file with these pages:

### 00 Cover

Use this page for:

- file title
- project summary
- design principles
- links to docs

Suggested title:

- ORAGH Community App

### 01 Foundations

Use this page for:

- colors
- typography
- spacing scale
- radius scale
- elevation rules
- icon rules
- responsive layout rules

### 02 Low-Fi Wireframes

Use this page for:

- grayscale layouts
- feed and event flow exploration
- navigation testing
- content hierarchy checks

### 03 Visual Directions

Use this page for:

- palette exploration
- typography exploration
- surface and tone studies

Keep one approved working direction and iterate from it.

### 04 High-Fi Core Screens

Use this page for polished versions of:

- feed
- events
- attendance flow
- profile basics

### 05 Prototype

Use this page for:

- feed browsing flow
- event detail flow
- attendance response flow
- profile/settings flow

### 06 Components

Use this page for reusable components:

- buttons
- tabs
- inputs
- chips
- cards
- feed items
- event items
- update blocks
- comment blocks
- attendance controls

### 07 Specs

Use this page for handoff notes:

- spacing annotations
- typography sizes
- color usage
- responsive behavior
- interaction states

## Recommended Frame Strategy

Design for phone first, but keep responsive web in scope from the beginning.

Create these base frames:

- Small phone: 390 px wide
- Large phone if needed: 430 px wide
- Web review frames for core screens

## Layout Rules

Use these rules from the beginning:

- 8-point spacing system
- minimum touch target around 44 px
- calm header treatment
- predictable navigation
- consistent card padding
- web layouts that use sidebars only when useful

## Naming Convention

Use clean and stable names in Figma.

Examples:

- `WF / Feed / Home / Small`
- `WF / Feed / Home / Web`
- `WF / Events / List / Small`
- `WF / Events / Detail / Small`
- `HF / Events / Detail / Web`
- `CMP / Event Card`
- `CMP / Attendance Block`

## First Screens To Maintain In Figma

Start with these core screens:

1. Feed / Home / Small
2. Feed / Home / Web
3. Events / Detail / Small
4. Events / Detail / Web
5. Events / List / Small
6. Events / Attendance / Small

These define most of the product grammar for v1.

## What Each First Screen Should Prove

### Feed / Home

Should prove:

- the feed is clearly the front door
- post density works on phone and web
- posting remains available without becoming a dominant CTA

### Events / Detail

Should prove:

- event information is easy to scan
- official updates can live inside the event body cleanly
- comments do not overwhelm official information
- setlist and attendance are easy to access

### Events / List

Should prove:

- upcoming events are easy to browse
- date-first scanning works
- this section feels modern, not like a legacy forum

### Events / Attendance

Should prove:

- response controls are obvious
- aggregate attendance is easy to understand

## Suggested Wireframe Fidelity Rules

In low-fi:

- use blocks, labels, and grayscale
- avoid final colors
- avoid polished icons
- focus on hierarchy and spacing

In high-fi:

- introduce the working ORAGH color system
- introduce the approved type scale
- define interactive states
- validate the visual balance across phone and web

## Foundations To Define Early

Do not delay these for too long:

- primary brand green usage
- neutral surface scale
- type scale
- corner radius style
- elevation style
- card and chip rules

## Suggested Component Starter List

Build these as the first reusable Figma components:

- Primary button
- Secondary button
- Quiet action button
- Search field
- Top app bar
- Tab bar item
- Feed post card
- Event list row
- Event detail hero
- Official update block
- Comment block
- Attendance selector
- Status badge
- Empty state block

## Industry Standard Rules To Keep

We should borrow standard behavior, not generic visuals.

Keep standard:

- navigation patterns
- form behavior
- modal behavior
- settings structure
- accessibility expectations

Customize:

- typography personality
- palette
- surfaces
- content rhythm
- orchestra-specific tone

## Recommended Working Principle

Do not design every screen at once.

Keep one coherent slice healthy first:

- feed home
- event detail
- event list
- attendance

Then extend the same logic into the rest of the product.

## Best Immediate Action In Figma

Keep the current baseline up to date, then:

1. refine high-fi feed and event screens
2. keep the components page aligned with real screens
3. push a new review round into Figma when the next iteration is ready
