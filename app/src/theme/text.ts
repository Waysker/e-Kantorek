import type { TextStyle } from "react-native";

import { themedValues } from "./theme";
import { tokens } from "./tokens";

// Text styles of the "Partytura" design system. Use these instead of
// re-declaring font sizes in screens; see docs/design-system.md. Colours follow
// the active theme.
export const textStyles = themedValues((colors) => ({
  /** Small uppercase label above a section or card ("SKŁAD", "TEN TYDZIEŃ"). */
  kicker: {
    fontSize: tokens.typography.caption,
    fontWeight: "600",
    letterSpacing: 0.7,
    textTransform: "uppercase",
    color: colors.muted,
  },
  /** Top-level screen title ("Wydarzenia", "Cześć, Wojciech"). */
  screenTitle: {
    fontSize: tokens.typography.hero,
    lineHeight: 36,
    fontWeight: "800",
    letterSpacing: -0.5,
    color: colors.ink,
  },
  /** Title of a tool page inside "Zarząd" or a detail header. */
  pageTitle: {
    fontSize: 26,
    lineHeight: 31,
    fontWeight: "800",
    letterSpacing: -0.4,
    color: colors.ink,
  },
  /** Card or group heading ("Trąbki", "Barbórka PBI"). */
  sectionTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.ink,
  },
  /** Primary line of a list row. */
  rowTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: colors.ink,
  },
  /** Running text. */
  body: {
    fontSize: tokens.typography.body,
    lineHeight: 24,
    color: colors.ink,
  },
  /** Secondary text: descriptions, hints. */
  muted: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.muted,
  },
  /** Small metadata under a row: time, venue, author. */
  meta: {
    fontSize: 13,
    color: colors.muted,
  },
  /** Inline text action ("Kalendarz ›", "Zmień"). */
  link: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.brand,
  },
} satisfies Record<string, TextStyle>));
