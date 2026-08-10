import { useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { ipc } from "../../lib/ipc";
import { useSettings } from "../../lib/settings";
import { Button, Toggle } from "../../components/ui";
import { ACCENTS } from "../settings/pages";
import { ShortcutRecorder } from "../shortcuts/ShortcutRecorder";
import logoUrl from "../../assets/clipath-logo.png";

export function Onboarding() {
  const { settings, update } = useSettings();
  const [step, setStep] = useState(0);
  const [folder, setFolder] = useState("");
  const [folderError, setFolderError] = useState<string | null>(null);
  const [folderValid, setFolderValid] = useState(false);
  const [shortcut, setShortcut] = useState<string | null>(null);
  const [launchAtStartup, setLaunchAtStartup] = useState(true);
  const [notifications, setNotifications] = useState(true);
  const [theme, setTheme] = useState<"system" | "light" | "dark">("system");
  const [accent, setAccent] = useState("");

  // Seeded from the real defaults rather than repeated here. Onboarding writes
  // whatever it is holding when it finishes, so a copy of the default that
  // drifts — as "Ctrl+Shift+A" did — silently overwrites the true one on every
  // fresh install.
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || !settings) return;
    seeded.current = true;
    setShortcut(settings.shortcuts.region);
    setAccent(settings.appearance.accent);
  }, [settings]);

  // Preview the chosen appearance live, before anything is persisted.
  useEffect(() => {
    const dark =
      theme === "dark" ||
      (theme === "system" &&
        window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.classList.toggle("dark", dark);
    document.documentElement.style.setProperty("--accent", accent);
  }, [theme, accent]);

  useEffect(() => {
    ipc.getDefaultFolder().then((f) => {
      setFolder(f);
      validate(f);
    });
  }, []);

  const validate = async (path: string) => {
    if (!path.trim()) {
      setFolderValid(false);
      setFolderError(null);
      return;
    }
    try {
      await ipc.validateFolder(path);
      setFolderValid(true);
      setFolderError(null);
    } catch (e) {
      setFolderValid(false);
      setFolderError(String(e));
    }
  };

  const chooseFolder = async () => {
    const picked = await open({ directory: true, defaultPath: folder });
    if (typeof picked === "string") {
      setFolder(picked);
      validate(picked);
    }
  };

  const finish = async (test: boolean) => {
    await update({
      onboardingCompleted: true,
      general: { launchAtStartup, notifications },
      output: { folder },
      shortcuts: { region: shortcut },
      appearance: { theme, accent },
    });
    if (test) {
      await ipc.hideMainWindow();
      setTimeout(() => ipc.triggerCapture("region"), 250);
    } else {
      await ipc.hideMainWindow();
    }
  };

  if (!settings || !accent) return null;

  const steps = [
    // 0 — Welcome
    <div key="welcome" className="flex flex-col items-center text-center">
      <img
        src={logoUrl}
        alt=""
        draggable={false}
        className="app-logo mb-7 h-[132px] w-[132px] select-none object-contain"
      />
      <h1 className="text-[26px] font-semibold tracking-tight">Clipath</h1>
      <p className="mt-2 text-[14px]" style={{ color: "var(--text-2)" }}>
        Capture. Annotate. Paste the path.
      </p>
      <p className="mt-1 text-[13px]" style={{ color: "var(--text-2)" }}>
        Fast screenshots for developer workflows.
      </p>
      <Button variant="primary" className="mt-9 !px-8" onClick={() => setStep(1)}>
        Continue
      </Button>
    </div>,

    // 1 — Folder
    <div key="folder" className="w-full max-w-[440px]">
      <h2 className="text-center text-[20px] font-semibold tracking-tight">
        Where should screenshots be saved?
      </h2>
      <p
        className="mt-2 text-center text-[13px]"
        style={{ color: "var(--text-2)" }}
      >
        Every capture is automatically saved here.
        <br />
        You can change this later in Settings.
      </p>
      <div className="mt-7 flex gap-2">
        <input
          type="text"
          value={folder}
          onChange={(e) => {
            setFolder(e.target.value);
            validate(e.target.value);
          }}
          className="w-full text-[13px]"
          spellCheck={false}
        />
        <Button onClick={chooseFolder}>Choose…</Button>
      </div>
      {folderError && (
        <p className="mt-2 text-[12px]" style={{ color: "var(--destructive)" }}>
          {folderError}
        </p>
      )}
      <div className="mt-9 flex justify-center">
        <Button
          variant="primary"
          className="!px-8"
          disabled={!folderValid}
          onClick={() => setStep(2)}
        >
          Continue
        </Button>
      </div>
    </div>,

    // 2 — Shortcut
    <div key="shortcut" className="flex w-full max-w-[440px] flex-col items-center">
      <h2 className="text-[20px] font-semibold tracking-tight">
        Capture shortcut
      </h2>
      <p className="mt-2 text-center text-[13px]" style={{ color: "var(--text-2)" }}>
        Press this shortcut anywhere to capture your screen.
      </p>
      <div className="mt-7">
        <ShortcutRecorder value={shortcut} onChange={setShortcut} />
      </div>
      <Button
        variant="primary"
        className="mt-9 !px-8"
        disabled={!shortcut}
        onClick={() => setStep(3)}
      >
        Continue
      </Button>
    </div>,

    // 3 — Appearance
    <div key="appearance" className="w-full max-w-[420px]">
      <h2 className="text-center text-[20px] font-semibold tracking-tight">
        Appearance
      </h2>
      <p className="mt-2 text-center text-[13px]" style={{ color: "var(--text-2)" }}>
        You can change this later in Settings.
      </p>
      <div className="mt-7 flex justify-center gap-2">
        {(["system", "light", "dark"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTheme(t)}
            className="w-[104px] rounded-[12px] border px-3 py-3 text-[13px] font-medium capitalize"
            style={{
              background: theme === t ? "var(--accent)" : "var(--panel)",
              borderColor: theme === t ? "var(--accent)" : "var(--border)",
              color: theme === t ? "#fff" : "var(--text)",
            }}
          >
            <div
              className="mx-auto mb-2 h-8 w-12 rounded-[6px] border"
              style={{
                borderColor: "rgba(128,128,128,0.35)",
                background:
                  t === "light"
                    ? "#F5F5F7"
                    : t === "dark"
                      ? "#1C1C1E"
                      : "linear-gradient(105deg, #F5F5F7 50%, #1C1C1E 50%)",
              }}
            />
            {t}
          </button>
        ))}
      </div>
      <div className="mt-6">
        <div
          className="mb-2 text-center text-[12px] font-medium"
          style={{ color: "var(--text-2)" }}
        >
          Accent color
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2.5">
          {ACCENTS.map((c) => (
            <button
              key={c.value}
              title={c.label}
              aria-label={c.label}
              onClick={() => setAccent(c.value)}
              className="h-7 w-7 rounded-full transition-transform hover:scale-110"
              style={{
                background: c.value,
                boxShadow:
                  accent === c.value
                    ? "0 0 0 2px var(--bg), 0 0 0 4px var(--accent)"
                    : "none",
              }}
            />
          ))}
        </div>
      </div>
      <div className="mt-9 flex justify-center">
        <Button variant="primary" className="!px-8" onClick={() => setStep(4)}>
          Continue
        </Button>
      </div>
    </div>,

    // 4 — Startup behavior
    <div key="startup" className="w-full max-w-[400px]">
      <h2 className="text-center text-[20px] font-semibold tracking-tight">
        Startup
      </h2>
      <div
        className="mt-7 divide-y rounded-[12px] border px-4"
        style={{ background: "var(--panel)", borderColor: "var(--border)" }}
      >
        <div className="flex items-center justify-between py-3">
          <span className="text-[13px]">Launch Clipath when Windows starts</span>
          <Toggle checked={launchAtStartup} onChange={setLaunchAtStartup} />
        </div>
        <div
          className="flex items-center justify-between border-t py-3"
          style={{ borderColor: "var(--border)" }}
        >
          <span className="text-[13px]">Keep Clipath in system tray</span>
          <Toggle checked={true} onChange={() => {}} disabled />
        </div>
        <div
          className="flex items-center justify-between border-t py-3"
          style={{ borderColor: "var(--border)" }}
        >
          <span className="text-[13px]">Show completion notification</span>
          <Toggle checked={notifications} onChange={setNotifications} />
        </div>
      </div>
      <div className="mt-9 flex justify-center">
        <Button variant="primary" className="!px-8" onClick={() => setStep(5)}>
          Continue
        </Button>
      </div>
    </div>,

    // 5 — Ready
    <div key="ready" className="flex flex-col items-center text-center">
      <div
        className="mb-5 flex h-14 w-14 items-center justify-center rounded-full text-2xl text-white"
        style={{ background: "var(--success)" }}
      >
        ✓
      </div>
      <h2 className="text-[22px] font-semibold tracking-tight">You're ready.</h2>
      <div
        className="mt-4 rounded-[10px] border px-4 py-2 text-[15px] font-semibold tracking-wide"
        style={{ background: "var(--panel)", borderColor: "var(--border)" }}
      >
        {shortcut}
      </div>
      <div className="mt-9 flex gap-3">
        <Button onClick={() => finish(true)}>Take a test screenshot</Button>
        <Button variant="primary" className="!px-8" onClick={() => finish(false)}>
          Finish
        </Button>
      </div>
    </div>,
  ];

  return (
    <div
      className="flex h-full flex-col items-center justify-center px-10"
      style={{ background: "var(--bg)" }}
    >
      {steps[step]}
      <div className="absolute bottom-6 flex gap-1.5">
        {steps.map((_, i) => (
          <div
            key={i}
            className="h-1.5 w-1.5 rounded-full transition-colors"
            style={{
              background: i === step ? "var(--accent)" : "var(--control-hover)",
            }}
          />
        ))}
      </div>
    </div>
  );
}
