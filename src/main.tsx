import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "./styles.css";

const label = getCurrentWindow().label;
const OVERLAY_PREFIX = "overlay-";

// Apply the theme before React renders anything. Waiting for settings to load
// means the first paint uses the light palette, so a window that is shown
// before the app has rendered — or that never renders because the settings
// call failed — is a sheet of white rather than the dark surface it should be.
try {
  const cached = localStorage.getItem("clipath-dark");
  const dark =
    cached === null
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
      : cached === "1";
  document.documentElement.classList.toggle("dark", dark);
} catch {
  /* storage unavailable; the settings load will set it shortly */
}

const root = ReactDOM.createRoot(document.getElementById("root")!);

// Loaded per window kind, not up front: the selection overlay has no use for
// the annotation canvas or the settings UI, and those are the bulk of the
// bundle. Overlay windows sit in memory for the life of the app, so what they
// never load is memory never spent.
if (label.startsWith(OVERLAY_PREFIX)) {
  document.body.classList.add("overlay-body");
  import("./features/capture/CaptureOverlay").then(({ CaptureOverlay }) => {
    root.render(
      <React.StrictMode>
        <CaptureOverlay monitor={Number(label.slice(OVERLAY_PREFIX.length))} />
      </React.StrictMode>,
    );
  });
} else {
  import("./app/MainWindow").then(({ MainWindow }) => {
    root.render(
      <React.StrictMode>
        <MainWindow />
      </React.StrictMode>,
    );
  });
}
