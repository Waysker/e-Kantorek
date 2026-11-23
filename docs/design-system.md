# Design system: "Partytura"

The visual language of e-Kantorek. The code is the source of truth; this page
explains what each piece is for and the rules that are easy to break when
adding a screen.

The app answers two questions for a musician: **where and when do I play**, and
**have I declared yet**. Everything else is secondary.

## Principles

1. **Colour carries meaning, not decoration.** The ground is cool white, the
   brand is AGH green. Other colours appear only as attendance status.
2. **Amber means "waiting for you".** It is the only loud colour, reserved for
   things the user must act on (a missing declaration, people without an
   instrument). Never use it for decoration or plain warnings about data.
3. **Status is colour + glyph + shape**, never colour alone (see
   [Status](#status)).
4. **Content over cards.** Prefer one card with rows and dividers over a stack of
   cards. Show the event date as an anchor on the left, the status on the right.
5. **Polish, plain, with diacritics.** No "Bede", no "RSVP", no "Supabase",
   "ref", "sync metadata" for members. No instructions like "Kliknij kafelek…".
6. **Declaring happens on the forum.** The app shows the declaration and links
   to the poll in the thread; it never writes one.

## Tokens

`app/src/theme/tokens.ts`. Names stay stable; values define the look.

| Token | Value | Use |
|---|---|---|
| `background` | `#F5F6F3` | Screen ground |
| `surface` | `#FFFFFF` | Cards, inputs, tab bar |
| `surfaceMuted` | `#EEF0EC` | Segmented track, dividers, neutral pills |
| `brand` | `#00693C` | Primary buttons, links, active tab, "today" |
| `brandTint` | `#DDF1E4` | Active nav item, selected session |
| `brandDeep` | `#0B2E20` | Dark headers: event hero, next performance, avatar, auth panel |
| `brandDeepRaised` / `brandDeepMuted` / `brandDeepAccent` | | Buttons, secondary text and kickers on `brandDeep` |
| `ink` / `muted` | `#121512` / `#4A524C` | Text / secondary text |
| `border` / `borderStrong` | `#E1E4DF` / `#D3D8D1` | Card outlines / decorative lines (dashed empty states) — never the only edge of a control |
| `controlBorder` | `#7D867F` | Outline of interactive controls: inputs, chips, secondary buttons (3.7:1 on white) |
| `focus` | `#00693C` | Keyboard focus ring (with a white halo), drawn globally on web |
| `success*` | `#DDF1E4` / `#0B5A33` | Going, present |
| `danger*` | `#F9E1DF` / `#8F2A22` | Not going, errors |
| `warning*` + `warningBorder` | `#FFF4DB` / `#7A4B00` / `#C77A00` | Needs your action |
| `warningStrong` | `#A35F00` | Amber fill that carries white text: count badges, selected action chip (5:1) |
| `neutral*` | `#EEF0EC` / `#3A413C` | Maybe, info |
| `reader*` | | Setlist stand mode only |

Control heights `controlHeight.sm 40 · md 44 · lg 48` (chips/segments, toolbar
buttons, form fields and the declaration CTA). One elevation: `shadow.raised`
(the active segment only).

Spacing `xs 6 · sm 10 · md 16 · lg 24 · xl 32`. Radii `sm 10 · md 12 (buttons,
inputs) · lg 16 (cards) · xl 20 (hero cards) · round (pills)`. Desktop
breakpoint: `960`.

Font: **Inter** on web (loaded in `app/src/theme/webFonts.ts`, tabular figures
on), system font on native.

## Text styles

`app/src/theme/text.ts` — use `textStyles.x` in `StyleSheet.create` instead of
re-declaring sizes.

| Style | Example |
|---|---|
| `screenTitle` (30/800) | "Wydarzenia", "Cześć, Wojciech" |
| `pageTitle` (26/800) | "Dni Bieżanowa 2026", "19 kont" |
| `kicker` (12, uppercase) | "SKŁAD", "TEN TYDZIEŃ", "TWOJA DEKLARACJA" |
| `sectionTitle` (16/700) | "Trąbki" |
| `rowTitle` (15/600) | event or person in a list |
| `body`, `muted`, `meta` | text, descriptions, time/venue |
| `link` | "Kalendarz ›", "Zmień" |

## Components

All in `app/src/ui/`.

| Component | Use it for | Don't use it for |
|---|---|---|
| `StatusPill`, `statusMeta()` | Any attendance status (pill, tile, calendar cell colours) | Anything that isn't a declaration status |
| `DeclarationPrompt` | The amber "Czeka na Twoją deklarację" card with "Zadeklaruj na forum ↗" | — |
| `SegmentedControl` | Switching views of the same content: Lista/Kalendarz, Nadchodzące/Minione, A–Z/Ranking | Choosing a value in a form |
| `Chip` | Picking a value or a filter: instruments, roles filter, date ranges. `tone="action"` for the amber "Bez deklaracji" filter, `role="radio"` for single choice | Status display |
| `Button` | `primary` = the one main action on a screen; `secondary` otherwise; `trailingIcon="external"` for links leaving the app | Inline text actions (use `textStyles.link`) |
| `Card`, `listRowDivider` | Grouping content; `variant="list"` for rows with dividers; `variant="action"` only for amber "waiting for you" | Wrapping every single element |
| `Notice` | Inline result/error bars: `error`, `success`, `warning` (unsaved changes), `info` | Page-level banners |
| `TextField` | Every text input: label above, `error` or `hint` below, 48px, `controlBorder` | Bare `TextInput` in screens |
| `EventRow` | Every event in a list: `dateStyle="anchor"` (grouped by month) or `"inline"` (short lists) | Custom event rows |
| `Badge` | Counts waiting for the user: `strong` (navigation), `soft` ("3 do przypisania") | Status (use StatusPill) |
| `EmptyState` | "Nothing here yet"; `tone="done"` when empty is good news | Errors (use Notice) |
| `Icon` | Stroke icons on a 24px grid (nav, chevrons, external link, bell) | Emoji |
| `AppShell`, `BoardSubNav` | Navigation (see below) | — |
| `AuthLayout` | Sign-in and sign-up frame | — |

## Patterns

### Status

| Status | Look | Glyph |
|---|---|---|
| Going (`going`) | green fill | ✓ |
| Not going (`not_going`) | red fill | ✕ |
| No declaration (`no_response`) | amber fill **with amber outline** | ! |
| Maybe (`maybe`) | grey | ? |

The forum poll has no "maybe", and the full roster is unknown, so don't show
"maybe" or "no response" **counts**. "No declaration" is shown only for the
user's own status. When a day has several events, the calendar shows the most
urgent status (`no_response` > `maybe` > `going` > `not_going`).

### Declarations

- Source of truth: the poll in the forum thread. The link is built from the
  event id `forum-event-<tid>` by `app/src/domain/forumLinks.ts`.
- Missing declaration → `DeclarationPrompt` (Start, calendar) or an amber card
  with a primary "Zadeklaruj na forum ↗" (event detail). Existing declaration →
  status pill + secondary "Zmień na forum ↗".
- Always say the change shows up after the next sync (up to ~20 min).

### Events

- Forum titles start with a date; strip it with `stripTitleDatePrefix` wherever a
  title is shown.
- List rows: weekday + day number on the left, title + "time · venue", status
  pill on the right; grouped by month.
- Setlist titles: `cleanSetlistLabel`; a missing setlist is
  `isPlaceholderSetlist` → "Setlisty jeszcze nie ma".

### People lists

- Sort by **surname** (last word of "First Last"), then full name, Polish
  collation.
- Multi-column lists fill **column by column, top to bottom**, so the alphabet
  reads down like a printed list. Names may wrap to two lines; never cut a
  surname off.

### Navigation

- Four tabs: **Start**, **Wydarzenia**, **Zarząd** (section/board/admin only),
  **Ja**. Sidebar on desktop (≥960), bottom bar on phones.
- Wydarzenia: one month + agenda view on desktop; Lista/Kalendarz switch on
  phones (the phone calendar shows one week).
- Board tools are sub-tabs of Zarząd (`BoardSubNav`): Obecność, Podsumowanie i
  punkty, Role, Instrumenty — each only for the roles that can use it. A count
  badge ("N do przypisania") replaces banners for people who can act.

### Copy

- Polish with diacritics in every `tr("…", "…")`. Plural forms matter
  ("2 wydarzenia czekają", "5 wydarzeń czeka", "1 konto / 2 konta / 5 kont").
- Say what happens, not how: "Dane z forum zsynchronizowane 7 min temu", not
  "Supabase (chmura)".

## Accessibility

- Text contrast ≥ 4.5:1 (all token pairs pass with margin; check new pairs).
- Control edges and focus ≥ 3:1: use `controlBorder` for controls, never
  `border`/`borderStrong` alone.
- Keyboard focus is drawn globally (`app/src/theme/webFonts.ts`); don't remove
  outlines in components.
- Touch targets ≥ 44px; chips are 40px with `hitSlop`.
- Status never by colour alone (glyph + shape).

## Hidden features

- Attendance reminders ("Ponaglij") are off via
  `ATTENDANCE_REMINDERS_ENABLED = false` in `app/App.tsx`; the code is kept for
  a future branch.

## Checking a change

```sh
cd app
npm run typecheck
npm run web   # http://localhost:8081
```

Check both a desktop width (≥960) and a phone width (375). The sign-in screen
can be viewed without signing out at `http://[::1]:8081` (separate storage).

## Design files

The design system is also published in Claude Design as
**"e-Kantorek — Partytura"** (https://claude.ai/artifact/7t7fK3rmrXjjaeqGui5EAg):
tokens, text styles, the brand book and static cards of the main components.
New design canvases pick it up automatically. When tokens or components change
in the code, update that system too (it is not synced automatically).


The original exploration (Claude Design canvas) is
"e-Kantorek — redesign aplikacji". It is a historical reference: where it
differs from the app (one Wydarzenia tab, no maybe/no-response counts), the app
wins.
