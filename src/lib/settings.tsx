import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { listen } from "@tauri-apps/api/event";
import { ipc } from "./ipc";
import type { Settings } from "../types";
import { deepMerge, type DeepPartial } from "./merge";

interface SettingsCtx {
  settings: Settings | null;
  /** Set once the settings could not be loaded at all, so the UI can say so. */
  loadError: string | null;
  /** Deep-merge a partial patch, persist it, and return shortcut errors. */
  update: (patch: DeepPartial<Settings>) => Promise<string[]>;
  replace: (next: Settings) => Promise<string[]>;
}

const Ctx = createContext<SettingsCtx>({
  settings: null,
  loadError: null,
  update: async () => [],
  replace: async () => [],
});

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    // One attempt with the failure swallowed left the window permanently
    // blank: nothing rendered, nothing retried, nothing said. The window can
    // be shown before the backend is ready to answer, so this retries.
    (async () => {
      for (let attempt = 0; attempt < 6; attempt++) {
        try {
          const loaded = await ipc.getSettings();
          if (cancelled) return;
          setSettings(loaded);
          setLoadError(null);
          return;
        } catch (e) {
          if (cancelled) return;
          console.error("could not load settings", e);
          if (attempt === 5) setLoadError(String(e));
          else await new Promise((r) => setTimeout(r, 150 * (attempt + 1)));
        }
      }
    })();

    const unlisten = listen<Settings>("settings-changed", (e) =>
      setSettings(e.payload),
    );
    return () => {
      cancelled = true;
      unlisten.then((f) => f());
    };
  }, []);

  const replace = useCallback(async (next: Settings) => {
    setSettings(next);
    try {
      return await ipc.setSettings(next);
    } catch (e) {
      console.error(e);
      return [String(e)];
    }
  }, []);

  const update = useCallback(
    async (patch: DeepPartial<Settings>) => {
      const current = await ipc.getSettings();
      return replace(deepMerge(current, patch));
    },
    [replace],
  );

  const value = useMemo(
    () => ({ settings, loadError, update, replace }),
    [settings, loadError, update, replace],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useSettings = () => useContext(Ctx);

/** Apply light/dark theme + accent color to the document. */
export function useApplyTheme(settings: Settings | null) {
  useEffect(() => {
    if (!settings) return;
    const apply = () => {
      const theme = settings.appearance.theme;
      const dark =
        theme === "dark" ||
        (theme === "system" &&
          window.matchMedia("(prefers-color-scheme: dark)").matches);
      document.documentElement.classList.toggle("dark", dark);
      try {
        localStorage.setItem("clipath-dark", dark ? "1" : "0");
      } catch {
        /* storage unavailable; only affects the next first paint */
      }
      document.documentElement.style.setProperty(
        "--accent",
        settings.appearance.accent,
      );
    };
    apply();
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [settings]);
}
