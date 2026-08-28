"use client";

import { createContext, useCallback, useContext, useEffect, useSyncExternalStore } from "react";
import {
  applyTheme,
  readStoredPreference,
  systemTheme,
  THEME_STORAGE_KEY,
  type ResolvedTheme,
  type ThemePreference,
} from "@/lib/theme";

type ThemeContextValue = {
  preference: ThemePreference;
  resolved: ResolvedTheme;
  setPreference: (preference: ThemePreference) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

// localStorage and matchMedia are external stores, so they are read through
// useSyncExternalStore rather than mirrored into state by an effect.
const listeners = new Set<() => void>();

// Set on every change so the toggle still works when localStorage is blocked
// (private windows), where the stored value would otherwise never update.
let sessionPreference: ThemePreference | null = null;

function getPreference(): ThemePreference {
  return sessionPreference ?? readStoredPreference();
}

function subscribePreference(onChange: () => void) {
  listeners.add(onChange);
  // Another tab changing the theme fires "storage" here.
  const onStorage = () => {
    sessionPreference = null;
    onChange();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
  };
}

function subscribeSystem(onChange: () => void) {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const preference = useSyncExternalStore(
    subscribePreference,
    getPreference,
    () => "system" as ThemePreference,
  );
  const system = useSyncExternalStore(
    subscribeSystem,
    systemTheme,
    () => "light" as ResolvedTheme,
  );
  const resolved: ResolvedTheme = preference === "system" ? system : preference;

  // Push the resolved theme out to the DOM (the head script did this for the
  // first paint; this keeps it in step afterwards).
  useEffect(() => {
    applyTheme(resolved);
  }, [resolved]);

  const setPreference = useCallback((next: ThemePreference) => {
    sessionPreference = next;
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Storage unavailable: the choice still holds for this session.
    }
    for (const listener of listeners) listener();
  }, []);

  return (
    <ThemeContext.Provider value={{ preference, resolved, setPreference }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used inside ThemeProvider");
  return context;
}
