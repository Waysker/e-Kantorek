// "Partytura" design tokens. Cool white ground, AGH green as the brand,
// colour reserved for meaning (status), amber only for "needs your action".
// Two colour themes, light and dark; every colour has both values. Screens
// never read a palette directly: they use `colors` / `themedStyles` from
// ./theme, which follow the active theme.

const light = {
  background: "#F5F6F3",
  surface: "#FFFFFF",
  surfaceMuted: "#EEF0EC",
  brand: "#00693C",
  /** Text and icons on a brand fill (primary button, today marker, selected chip). */
  onBrand: "#FFFFFF",
  brandTint: "#DDF1E4",
  brandDeep: "#0B2E20",
  brandDeepRaised: "#174532",
  brandDeepMuted: "#C9DCD1",
  brandDeepAccent: "#9FD3B5",
  /** White text on fills that stay dark in both themes: brand-deep, warning-strong, reader-chrome. */
  onStrong: "#FFFFFF",
  ink: "#121512",
  muted: "#4A524C",
  border: "#E1E4DF",
  borderStrong: "#D3D8D1",
  /** Outline of interactive controls (inputs, chips, secondary buttons): 3.7:1 on white. */
  controlBorder: "#7D867F",
  /** Keyboard focus ring. */
  focus: "#00693C",
  /** Halo around the focus ring, so it shows on light and brand-deep surfaces alike. */
  focusHalo: "#FFFFFF",
  successSurface: "#DDF1E4",
  successInk: "#0B5A33",
  dangerSurface: "#F9E1DF",
  dangerInk: "#8F2A22",
  warningSurface: "#FFF4DB",
  warningInk: "#7A4B00",
  warningBorder: "#C77A00",
  /** Amber fill that carries white text (badges, selected action chip): 5:1. */
  warningStrong: "#A35F00",
  neutralSurface: "#EEF0EC",
  neutralInk: "#3A413C",
  /** Overlay behind a modal sheet or panel. */
  scrim: "rgba(0,0,0,0.35)",
  paper: "#FAFBF9",
  readerBackdrop: "#171513",
  readerChrome: "#302C28",
  readerPage: "#FFFDF8",
  readerInk: "#131313",
  readerMeta: "#D9D2C7",
};

export type Palette = { readonly [K in keyof typeof light]: string };

const dark: Palette = {
  background: "#0F1311",
  surface: "#171C19",
  surfaceMuted: "#232A25",
  brand: "#5CC28A",
  onBrand: "#0B2E20",
  brandTint: "#173A28",
  brandDeep: "#123D2B",
  brandDeepRaised: "#1E5440",
  brandDeepMuted: "#C9DCD1",
  brandDeepAccent: "#9FD3B5",
  onStrong: "#FFFFFF",
  ink: "#E8ECE8",
  muted: "#A6B0A9",
  border: "#2A312C",
  borderStrong: "#38413B",
  controlBorder: "#7F8982",
  focus: "#5CC28A",
  focusHalo: "#0F1311",
  successSurface: "#163A26",
  successInk: "#93DDB0",
  dangerSurface: "#47201C",
  dangerInk: "#F5ADA5",
  warningSurface: "#3B2A08",
  warningInk: "#F4C877",
  warningBorder: "#D9901A",
  warningStrong: "#A35F00",
  neutralSurface: "#262D28",
  neutralInk: "#C8D0CA",
  scrim: "rgba(0,0,0,0.6)",
  paper: "#1D231F",
  readerBackdrop: "#171513",
  readerChrome: "#302C28",
  readerPage: "#FFFDF8",
  readerInk: "#131313",
  readerMeta: "#D9D2C7",
};

export type ColorScheme = "light" | "dark";

export const palettes: Record<ColorScheme, Palette> = { light, dark };

export const tokens = {
  spacing: {
    xs: 6,
    sm: 10,
    md: 16,
    lg: 24,
    xl: 32,
  },
  radii: {
    sm: 10,
    md: 12,
    lg: 16,
    xl: 20,
    round: 999,
  },
  typography: {
    hero: 30,
    title: 22,
    body: 16,
    caption: 12,
  },
  breakpoints: {
    desktop: 960,
  },
  /** Minimum heights of interactive controls (touch target ≥ 44). */
  controlHeight: {
    sm: 40,
    md: 44,
    lg: 48,
  },
  shadow: {
    /** The only elevation in the system: the active segment of a SegmentedControl. */
    raised: {
      shadowColor: "#000",
      shadowOpacity: 0.08,
      shadowRadius: 2,
      shadowOffset: { width: 0, height: 1 },
    },
  },
} as const;
