import { useSyncExternalStore } from "react";

import { APP_STORAGE_KEYS } from "./identity";

export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

const THEME_CHANGE_EVENT = "opengrove-theme-change";
const HOST_THEME_CHANGE_EVENT = "opengrove-host-theme-change";
const DARK_MEDIA_QUERY = "(prefers-color-scheme: dark)";
let stopDocumentThemeSync: (() => void) | undefined;
let hostSystemTheme: ResolvedTheme | undefined;
let hostSystemThemeRequest: Promise<void> | undefined;

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

function resolveTheme(preference: ThemePreference): ResolvedTheme {
  if (preference !== "system") {
    return preference;
  }
  if (hostSystemTheme) {
    return hostSystemTheme;
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
  const resolvedTheme = resolveTheme(preference);
  root.dataset.theme = preference;
  root.dataset.resolvedTheme = resolvedTheme;
  root.style.colorScheme = resolvedTheme;
}

export function startDocumentThemeSync(): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }
  if (stopDocumentThemeSync) {
    return stopDocumentThemeSync;
  }

  const media = window.matchMedia?.(DARK_MEDIA_QUERY);
  const handleChange = () => {
    applyDocumentTheme();
    void syncHostSystemTheme();
  };
  window.addEventListener("storage", handleChange);
  window.addEventListener(THEME_CHANGE_EVENT, handleChange);
  if (media?.addEventListener) {
    media.addEventListener("change", handleChange);
  } else {
    media?.addListener?.(handleChange);
  }
  applyDocumentTheme();
  void syncHostSystemTheme();
  const intervalId = window.setInterval(() => {
    if (readStoredThemePreference() === "system") {
      void syncHostSystemTheme();
    }
  }, 4000);

  stopDocumentThemeSync = () => {
    window.removeEventListener("storage", handleChange);
    window.removeEventListener(THEME_CHANGE_EVENT, handleChange);
    window.clearInterval(intervalId);
    if (media?.removeEventListener) {
      media.removeEventListener("change", handleChange);
    } else {
      media?.removeListener?.(handleChange);
    }
    stopDocumentThemeSync = undefined;
  };
  return stopDocumentThemeSync;
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
  if (preference === "system") {
    void syncHostSystemTheme();
  }
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
  window.addEventListener(THEME_CHANGE_EVENT, handleChange);
  window.addEventListener(HOST_THEME_CHANGE_EVENT, handleChange);
  window.addEventListener("storage", handleChange);
  if (media?.addEventListener) {
    media.addEventListener("change", handleChange);
  } else {
    media?.addListener?.(handleChange);
  }
  return () => {
    window.removeEventListener(THEME_CHANGE_EVENT, handleChange);
    window.removeEventListener(HOST_THEME_CHANGE_EVENT, handleChange);
    window.removeEventListener("storage", handleChange);
    if (media?.removeEventListener) {
      media.removeEventListener("change", handleChange);
    } else {
      media?.removeListener?.(handleChange);
    }
  };
}

function syncHostSystemTheme(): Promise<void> {
  if (typeof window === "undefined" || typeof fetch === "undefined") {
    return Promise.resolve();
  }
  if (hostSystemThemeRequest) {
    return hostSystemThemeRequest;
  }
  hostSystemThemeRequest = fetch("/health", { cache: "no-store" })
    .then((response) => (response.ok ? response.json() as Promise<unknown> : undefined))
    .then((payload) => {
      const nextTheme = readSystemThemeFromHealth(payload);
      if (!nextTheme || nextTheme === hostSystemTheme) return;
      hostSystemTheme = nextTheme;
      if (readStoredThemePreference() === "system") {
        applyDocumentTheme("system");
        window.dispatchEvent(new Event(HOST_THEME_CHANGE_EVENT));
      }
    })
    .catch(() => {
      // Standalone web builds can still fall back to matchMedia.
    })
    .finally(() => {
      hostSystemThemeRequest = undefined;
    });
  return hostSystemThemeRequest;
}

function readSystemThemeFromHealth(payload: unknown): ResolvedTheme | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const appearance = (payload as { appearance?: unknown }).appearance;
  if (!appearance || typeof appearance !== "object") return undefined;
  const systemTheme = (appearance as { systemTheme?: unknown }).systemTheme;
  return systemTheme === "dark" || systemTheme === "light" ? systemTheme : undefined;
}

export function useThemePreference() {
  const preference = useSyncExternalStore(subscribeTheme, readStoredThemePreference, () => "system");
  return {
    preference,
    setThemePreference,
  };
}
