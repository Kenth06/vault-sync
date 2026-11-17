import { useCallback, useEffect, useSyncExternalStore } from "react";

export type ThemePreference = "light" | "dark" | "system";

const KEY = "vault-sync-theme";
const DARK_QUERY = "(prefers-color-scheme: dark)";
const listeners = new Set<() => void>();

function readPreference(): ThemePreference {
  try {
    const value = localStorage.getItem(KEY);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const media = matchMedia(DARK_QUERY);
  media.addEventListener("change", listener);
  globalThis.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    media.removeEventListener("change", listener);
    globalThis.removeEventListener("storage", listener);
  };
}

function snapshot(): string {
  return `${readPreference()}:${matchMedia(DARK_QUERY).matches ? "dark" : "light"}`;
}

export function useTheme(): { preference: ThemePreference; setPreference: (p: ThemePreference) => void } {
  const [preference = "system", system = "light"] = useSyncExternalStore(subscribe, snapshot).split(":");
  const current: ThemePreference = preference === "light" || preference === "dark" ? preference : "system";
  const mode = current === "system" ? system : current;

  useEffect(() => {
    document.documentElement.dataset.mode = mode;
  }, [mode]);

  const setPreference = useCallback(
    (next: ThemePreference) => {
      try {
        localStorage.setItem(KEY, next);
      } catch {
        document.documentElement.dataset.mode = next === "system" ? system : next;
      }
      for (const listener of listeners) listener();
    },
    [system],
  );

  return { preference: current, setPreference };
}
