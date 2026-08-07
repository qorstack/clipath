import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { SettingsProvider, useApplyTheme, useSettings } from "../lib/settings";
import { Onboarding } from "../features/onboarding/Onboarding";
import { SettingsWindow } from "../features/settings/SettingsWindow";
import { Editor } from "../features/editor/Editor";

function MainContent() {
  const { settings } = useSettings();
  const [page, setPage] = useState("general");
  const [editorPath, setEditorPath] = useState<string | null>(null);
  // Settings sits on top of the editor rather than replacing it, so the
  // capture being worked on is still there to come back to.
  const [showSettings, setShowSettings] = useState(false);
  useApplyTheme(settings);

  useEffect(() => {
    const nav = listen<string>("navigate", (e) => {
      if (e.payload === "editor") return; // the open-editor event carries the path
      setPage(e.payload);
      setShowSettings(true);
    });
    const open = listen<string>("open-editor", (e) => {
      setEditorPath(e.payload);
      setShowSettings(false);
    });
    return () => {
      nav.then((f) => f());
      open.then((f) => f());
    };
  }, []);

  if (!settings) return null;
  if (!settings.onboardingCompleted) return <Onboarding />;

  if (editorPath && !showSettings)
    return (
      <Editor
        path={editorPath}
        settings={settings}
        onOpenSettings={() => setShowSettings(true)}
      />
    );
  return (
    <SettingsWindow
      page={page}
      setPage={setPage}
      onBack={editorPath ? () => setShowSettings(false) : undefined}
    />
  );
}

export function MainWindow() {
  return (
    <SettingsProvider>
      <MainContent />
    </SettingsProvider>
  );
}
