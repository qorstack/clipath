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
  useApplyTheme(settings);

  useEffect(() => {
    const nav = listen<string>("navigate", (e) => {
      if (e.payload === "editor") return; // the open-editor event carries the path
      setEditorPath(null);
      setPage(e.payload);
    });
    const open = listen<string>("open-editor", (e) => setEditorPath(e.payload));
    return () => {
      nav.then((f) => f());
      open.then((f) => f());
    };
  }, []);

  if (!settings) return null;
  if (!settings.onboardingCompleted) return <Onboarding />;
  if (editorPath)
    return (
      <Editor
        path={editorPath}
        settings={settings}
        onOpenSettings={() => setEditorPath(null)}
      />
    );
  return <SettingsWindow page={page} setPage={setPage} />;
}

export function MainWindow() {
  return (
    <SettingsProvider>
      <MainContent />
    </SettingsProvider>
  );
}
