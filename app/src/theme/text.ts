import type { TextStyle } from "react-native";

import { tokens } from "./tokens";

// Text styles of the "Partytura" design system. Use these instead of
// re-declaring font sizes in screens; see docs/design-system.md.
export const textStyles = {
  /** Small uppercase label above a section or card ("SKŁAD", "TEN TYDZIEŃ"). */
  kicker: {
    fontSize: tokens.typography.caption,
    fontWeight: "600",
    letterSpacing: 0.7,
    textTransform: "uppercase",
    color: tokens.colors.muted,
  },
  /** Top-level screen title ("Wydarzenia", "Cześć, Wojciech"). */
  screenTitle: {
    fontSize: tokens.typography.hero,
    lineHeight: 36,
    fontWeight: "800",
    letterSpacing: -0.5,
    color: tokens.colors.ink,
  },
  /** Title of a tool page inside "Zarząd" or a detail header. */
  pageTitle: {
    fontSize: 26,
    lineHeight: 31,
    fontWeight: "800",
    letterSpacing: -0.4,
    color: tokens.colors.ink,
  },
  /** Card or group heading ("Trąbki", "Barbórka PBI"). */
  sectionTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: tokens.colors.ink,
  },
  /** Primary line of a list row. */
  rowTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: tokens.colors.ink,
  },
  /** Running text. */
  body: {
    fontSize: tokens.typography.body,
    lineHeight: 24,
    color: tokens.colors.ink,
  },
  /** Secondary text: descriptions, hints. */
  muted: {
    fontSize: 14,
    lineHeight: 20,
    color: tokens.colors.muted,
  },
  /** Small metadata under a row: time, venue, author. */
  meta: {
    fontSize: 13,
    color: tokens.colors.muted,
  },
  /** Inline text action ("Kalendarz ›", "Zmień"). */
  link: {
    fontSize: 14,
    fontWeight: "600",
    color: tokens.colors.brand,
  },
} satisfies Record<string, TextStyle>;
