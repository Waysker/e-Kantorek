# Design system: "Partytura"

## Source of truth

The design system lives in Claude Design: **"e-Kantorek — Partytura"**
(https://claude.ai/artifact/7t7fK3rmrXjjaeqGui5EAg). It holds the decisions:
tokens, typography, colour and status rules, component specs, copy rules,
accessibility rules. Read its README before working on the UI.

This page does not repeat those rules. It says how the app implements the
system and how a change travels.

## How a change travels

1. **Decide in the system.** A new colour, size, component, pattern or copy
   rule is changed in the design system first.
2. **Implement in the code.** Update the matching token or component below, in
   the same change set as any screen that uses it.
3. **Never the other way round.** Don't change a token value or a component's
   look only in the code. If the code and the system disagree, the system wins:
   fix the code, or raise the question and change the system first.

Nothing syncs automatically in either direction; that is deliberate, so only an
explicit decision changes the look of the app.

## Where the system lives in the code

| System | Code |
|---|---|
| Colour tokens (`kebab-case`, e.g. `control-border`) | `app/src/theme/tokens.ts` → `tokens.colors.<camelCase>` (`controlBorder`) |
| Spacing `space-*`, radius `radius-*` | `tokens.spacing.*`, `tokens.radii.*` |
| `control-sm/md/lg`, shadow `raised`, breakpoint `desktop` | `tokens.controlHeight.*`, `tokens.shadow.raised`, `tokens.breakpoints.desktop` |
| Text styles (`screen-title`, `kicker`, …) | `app/src/theme/text.ts` → `textStyles.<camelCase>` |
| Font (Inter) and the global keyboard focus ring | `app/src/theme/webFonts.ts` |
| Components (cards in the system) | `app/src/ui/<Name>.tsx`: `StatusPill`, `DeclarationPrompt`, `SegmentedControl`, `Chip`, `Button`, `Card`, `Notice`, `TextField`, `EventRow`, `Badge`, `EmptyState`, `StatusMark`, `Tag`, `SectionTile` |
| App chrome (not carded) | `app/src/ui/`: `Icon`, `AppShell`, `BoardSubNav`, `AuthLayout`, `DataFreshnessBanner`, `UnmappedMembersBanner` |
| Pattern helpers | `app/src/domain/forumLinks.ts` (forum poll links), `stripTitleDatePrefix` in `app/src/utils/format.ts`, `app/src/domain/setlist.ts` |

Use these components in screens instead of copying styles.

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

Check both a desktop width (≥960) and a phone width (375), and keyboard focus
with Tab. The sign-in screen can be viewed without signing out at
`http://[::1]:8081` (separate storage).
