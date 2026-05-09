import { useSyncExternalStore } from "react";

import { APP_STORAGE_KEYS } from "./identity";

export type ThemePreference = "system" | "light" | "dark";

const THEME_CHANGE_EVENT = "opengrove-theme-change";
const DARK_MEDIA_QUERY = "(prefers-color-scheme: dark)";

function isThemePreference(value: string | null): value is ThemePreference {
  return value === "system" || value === "light" || value === "dark";
}

function readStoredThemePreference(): ThemePreference {
  if (typeof window === "undefined") {
    return "system";
  }
  try {
    const stored = window.localStorage.getItem(APP_STORAGE_KEYS.theme);
    return isThemePreference(stored) ? stored : "system";
  } catch {
    return "system";
  }
}

function resolveTheme(preference: ThemePreference): "light" | "dark" {
  if (preference !== "system") {
    return preference;
  }
  if (typeof window === "undefined" || !window.matchMedia) {
    return "light";
  }
  return window.matchMedia(DARK_MEDIA_QUERY).matches ? "dark" : "light";
}

export function applyDocumentTheme(preference: ThemePreference = readStoredThemePreference()): void {
  if (typeof document === "undefined") {
    return;
  }
  const root = document.documentElement;
  root.dataset.theme = preference;
  root.style.colorScheme = resolveTheme(preference);
}

export function setThemePreference(preference: ThemePreference): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(APP_STORAGE_KEYS.theme, preference);
  } catch {
    // Storage may be unavailable in private or restricted browser contexts.
  }
  applyDocumentTheme(preference);
  window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
}

function subscribeTheme(listener: () => void): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }
  const handleChange = () => {
    applyDocumentTheme();
    listener();
  };
  const media = window.matchMedia?.(DARK_MEDIA_QUERY);
  window.addEventListener(THEME_CHANGE_EVENT, listener);
  window.addEventListener("storage", handleChange);
  media?.addEventListener?.("change", handleChange);
  return () => {
    window.removeEventListener(THEME_CHANGE_EVENT, listener);
    window.removeEventListener("storage", handleChange);
    media?.removeEventListener?.("change", handleChange);
  };
}

export function useThemePreference() {
  const preference = useSyncExternalStore(subscribeTheme, readStoredThemePreference, () => "system");
  return {
    preference,
    setThemePreference,
  };
}
