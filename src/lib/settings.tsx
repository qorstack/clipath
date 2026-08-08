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
  /** Deep-merge a partial patch, persist it, and return shortcut errors. */
  update: (patch: DeepPartial<Settings>) => Promise<string[]>;
  replace: (next: Settings) => Promise<string[]>;
}

const Ctx = createContext<SettingsCtx>({
  settings: null,
  update: async () => [],
  replace: async () => [],
});

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<Settings | null>(null);

  useEffect(() => {
    ipc.getSettings().then(setSettings).catch(console.error);
    const unlisten = listen<Settings>("settings-changed", (e) =>
      setSettings(e.payload),
    );
    return () => {
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
    () => ({ settings, update, replace }),
    [settings, update, replace],
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
