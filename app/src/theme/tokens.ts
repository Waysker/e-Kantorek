// "Partytura" design tokens. Cool white ground, AGH green as the brand,
// colour reserved for meaning (status), amber only for "needs your action".
export const tokens = {
  colors: {
    background: "#F5F6F3",
    surface: "#FFFFFF",
    surfaceMuted: "#EEF0EC",
    brand: "#00693C",
    brandTint: "#DDF1E4",
    brandDeep: "#0B2E20",
    brandDeepRaised: "#174532",
    brandDeepMuted: "#C9DCD1",
    brandDeepAccent: "#9FD3B5",
    ink: "#121512",
    muted: "#4A524C",
    border: "#E1E4DF",
    borderStrong: "#D3D8D1",
    /** Outline of interactive controls (inputs, chips, secondary buttons): 3.7:1 on white. */
    controlBorder: "#7D867F",
    /** Keyboard focus ring (paired with a white halo so it shows on dark surfaces too). */
    focus: "#00693C",
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
    paper: "#FAFBF9",
    readerBackdrop: "#171513",
    readerChrome: "#302C28",
    readerPage: "#FFFDF8",
    readerInk: "#131313",
    readerMeta: "#D9D2C7",
  },
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
