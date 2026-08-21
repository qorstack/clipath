import React, { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { ipc } from "../lib/ipc";
import { SettingsProvider, useApplyTheme, useSettings } from "../lib/settings";
import { Onboarding } from "../features/onboarding/Onboarding";
import { SettingsWindow } from "../features/settings/SettingsWindow";
import { Editor } from "../features/editor/Editor";

function MainContent() {
  const { settings, loadError } = useSettings();
  const [page, setPage] = useState("general");
  const [editorPath, setEditorPath] = useState<string | null>(null);
  // Settings sits on top of the editor rather than replacing it, so the
  // capture being worked on is still there to come back to.
  const [showSettings, setShowSettings] = useState(false);
  // Opened straight from the shortcut there is no capture sitting behind
  // Settings, and without one there was no way back out of it at all. The most
  // recent capture is the way back.
  const [latest, setLatest] = useState<string | null>(null);
  useApplyTheme(settings);

  useEffect(() => {
    if (editorPath) return;
    ipc
      .listRecent(1)
      .then((r) => setLatest(r[0]?.path ?? null))
      .catch(() => setLatest(null));
  }, [editorPath, showSettings, page]);

  useEffect(() => {
    // The window may have just been recreated for this capture, in which case
    // the open-editor event fired before anything was listening.
    ipc
      .takePendingEditor()
      .then((p) => {
        if (p) {
          setEditorPath(p);
          setShowSettings(false);
          return;
        }
        // Nothing pending means the window opened on its own — at app start,
        // or from the tray. The most recent capture is what the app is for,
        // so it opens there rather than on Settings. Functional set: a real
        // capture that raced this lookup must win.
        return ipc.listRecent(1).then((r) => {
          const latest = r[0]?.path;
          if (latest) setEditorPath((cur) => cur ?? latest);
        });
      })
      .catch(console.error);

    const nav = listen<string>("navigate", (e) => {
      if (e.payload === "editor") return; // the open-editor event carries the path
      setPage(e.payload);
      setShowSettings(true);
    });
    const open = listen<string>("open-editor", (e) => {
      setEditorPath(e.payload);
      setShowSettings(false);
    });
    // Unmounting the editor when the window goes away releases the decoded
    // screenshot and the annotation canvas rather than holding them idle.
    const closed = listen("editor-closed", () => setEditorPath(null));
    return () => {
      nav.then((f) => f());
      open.then((f) => f());
      closed.then((f) => f());
    };
  }, []);

  // Never render nothing. A blank return here is indistinguishable from a
  // broken app: the window is already on screen by this point, so it shows as
  // a sheet of white with no explanation and no way out.
  if (!settings) return <Booting error={loadError} />;
  if (!settings.onboardingCompleted) return <Onboarding />;

  if (editorPath && !showSettings)
    return (
      <Editor
        path={editorPath}
        settings={settings}
        onOpenSettings={() => setShowSettings(true)}
      />
    );
  const back = editorPath
    ? () => setShowSettings(false)
    : latest
      ? () => {
          setEditorPath(latest);
          setShowSettings(false);
        }
      : undefined;

  return <SettingsWindow page={page} setPage={setPage} onBack={back} />;
}

/** Shown while settings are loading, and if they could not be loaded at all. */
function Booting({ error }: { error: string | null }) {
  return (
    <div
      className="flex h-full w-full flex-col items-center justify-center gap-3 px-8 text-center"
      style={{ background: "var(--bg)", color: "var(--text-2)" }}
    >
      {error ? (
        <>
          <div style={{ color: "var(--text)", fontWeight: 560 }}>
            Clipath could not read its settings
          </div>
          <div style={{ fontSize: 12.5, maxWidth: 420 }}>{error}</div>
          <button
            className="mt-2 rounded-lg px-4 py-2"
            style={{ background: "var(--accent)", color: "#fff" }}
            onClick={() => window.location.reload()}
          >
            Try again
          </button>
        </>
      ) : (
        <div style={{ fontSize: 13 }}>Loading…</div>
      )}
    </div>
  );
}

/**
 * The last line of defence against a blank window. Without a boundary, any
 * error that escapes a render or an effect makes React discard the entire
 * tree — the app then sits on screen as an empty rectangle of background
 * colour with no explanation and no way out, and stays that way for every
 * capture after.
 */
class CrashGuard extends React.Component<
  { children: React.ReactNode },
  { error: string | null }
> {
  state = { error: null as string | null };

  static getDerivedStateFromError(e: unknown) {
    return { error: String(e) };
  }

  componentDidCatch(e: unknown) {
    ipc.pageNote(`react tree crashed: ${e}`).catch(() => {});
  }

  render() {
    if (this.state.error === null) return this.props.children;
    return (
      <div
        className="flex h-full w-full flex-col items-center justify-center gap-3 px-8 text-center"
        style={{ background: "var(--bg)", color: "var(--text-2)" }}
      >
        <div style={{ color: "var(--text)", fontWeight: 560 }}>
          Something went wrong in this window
        </div>
        <div style={{ fontSize: 12, maxWidth: 460, wordBreak: "break-word" }}>
          {this.state.error}
        </div>
        <button
          className="mt-2 rounded-lg px-4 py-2"
          style={{ background: "var(--accent)", color: "#fff" }}
          onClick={() => window.location.reload()}
        >
          Reload
        </button>
      </div>
    );
  }
}

export function MainWindow() {

  return (
    <CrashGuard>
      <SettingsProvider>
        <MainContent />
      </SettingsProvider>
    </CrashGuard>
  );
}
