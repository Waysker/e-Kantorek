import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, useContext, useEffect, useState } from "react";
import { Platform, StyleSheet, useColorScheme } from "react-native";

import { palettes, type ColorScheme, type Palette } from "./tokens";

// Active colour theme of "Partytura" (light / dark).
//
// The theme follows the device setting unless the member picks one in
// Ja → Wygląd (Systemowy / Jasny / Ciemny); the choice is remembered on the
// device. The app root resolves the theme and calls setActiveColorScheme()
// before its tree renders, so `colors` and every `themedStyles` sheet read the
// active palette at render time. A theme change re-renders the whole tree from
// the root (nothing is memoised), so every screen picks up the new palette.

export type ThemePreference = "system" | ColorScheme;

let activeScheme: ColorScheme = "light";

export function setActiveColorScheme(scheme: ColorScheme) {
  activeScheme = scheme;
}

export function getActiveColorScheme(): ColorScheme {
  return activeScheme;
}

/** Colours of the active theme. Read them during render, never at module load. */
export const colors: Palette = new Proxy({} as Palette, {
  get: (_target, key) => palettes[activeScheme][key as keyof Palette],
});

/**
 * A StyleSheet whose colours follow the active theme. The factory gets the
 * palette; one sheet per theme is created lazily and cached.
 */
export function themedStyles<T extends StyleSheet.NamedStyles<T> | StyleSheet.NamedStyles<any>>(
  factory: (colors: Palette) => T & StyleSheet.NamedStyles<any>,
): T {
  const cache: Partial<Record<ColorScheme, T>> = {};
  const current = () => {
    const sheet = cache[activeScheme] ?? StyleSheet.create(factory(palettes[activeScheme]));
    cache[activeScheme] = sheet;
    return sheet;
  };
  return new Proxy({} as T, {
    get: (_target, key) => current()[key as keyof T],
    has: (_target, key) => key in current(),
    ownKeys: () => Reflect.ownKeys(current()),
    getOwnPropertyDescriptor: (_target, key) => {
      const descriptor = Object.getOwnPropertyDescriptor(current(), key);
      return descriptor ? { ...descriptor, configurable: true } : undefined;
    },
  });
}

/** Plain (non-StyleSheet) objects that depend on the palette, e.g. text styles. */
export function themedValues<T extends object>(factory: (colors: Palette) => T): T {
  const cache: Partial<Record<ColorScheme, T>> = {};
  const current = () => {
    const values = cache[activeScheme] ?? factory(palettes[activeScheme]);
    cache[activeScheme] = values;
    return values;
  };
  return new Proxy({} as T, {
    get: (_target, key) => current()[key as keyof T],
    has: (_target, key) => key in current(),
    ownKeys: () => Reflect.ownKeys(current()),
    getOwnPropertyDescriptor: (_target, key) => {
      const descriptor = Object.getOwnPropertyDescriptor(current(), key);
      return descriptor ? { ...descriptor, configurable: true } : undefined;
    },
  });
}

const PREFERENCE_STORAGE_KEY = "ekantorek.themePreference";

function isThemePreference(value: unknown): value is ThemePreference {
  return value === "system" || value === "light" || value === "dark";
}

type ThemeContextValue = {
  scheme: ColorScheme;
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
};

export const ThemeContext = createContext<ThemeContextValue>({
  scheme: "light",
  preference: "system",
  setPreference: () => undefined,
});

/** The active theme and the member's choice (Ja → Wygląd). */
export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}

/**
 * For the app root: resolves the theme from the device setting and the saved
 * preference, and makes it active before the tree renders.
 */
export function useThemeRoot(): ThemeContextValue {
  const systemScheme = useColorScheme();
  const [preference, setPreferenceState] = useState<ThemePreference>("system");

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(PREFERENCE_STORAGE_KEY)
      .then((stored) => {
        if (!cancelled && isThemePreference(stored)) {
          setPreferenceState(stored);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const scheme: ColorScheme =
    preference === "system" ? (systemScheme === "dark" ? "dark" : "light") : preference;
  setActiveColorScheme(scheme);

  useEffect(() => {
    applyWebDocumentTheme(scheme);
  }, [scheme]);

  const setPreference = (next: ThemePreference) => {
    setPreferenceState(next);
    AsyncStorage.setItem(PREFERENCE_STORAGE_KEY, next).catch(() => undefined);
  };

  return { scheme, preference, setPreference };
}

// On web: page background behind the app, native form controls and scrollbars
// (color-scheme), the browser chrome colour, and the focus ring colours.
function applyWebDocumentTheme(scheme: ColorScheme) {
  if (Platform.OS !== "web" || typeof document === "undefined") {
    return;
  }
  const palette = palettes[scheme];
  const root = document.documentElement;
  root.style.colorScheme = scheme;
  root.style.backgroundColor = palette.background;
  root.style.setProperty("--pt-focus", palette.focus);
  root.style.setProperty("--pt-focus-halo", palette.focusHalo);
  if (document.body) {
    document.body.style.backgroundColor = palette.background;
  }
  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement("meta");
    meta.name = "theme-color";
    document.head.appendChild(meta);
  }
  meta.content = palette.background;
}
