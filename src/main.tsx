import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { monitorOf } from "./lib/overlayLabel";
import "./styles.css";

const label = getCurrentWindow().label;
const overlayMonitor = monitorOf(label);

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

// Say so as early as possible, and say so when the page breaks: a window
// showing nothing but its background colour and a page that never ran look
// identical from the outside. Every window reports, not just the overlays —
// the editor was the one that came up blank.
const note = (n: string) =>
  invoke("page_note", { window: label, note: n }).catch(() => {});
note("page is live");
window.addEventListener("error", (e) => note(`page error: ${e.message}`));

const root = ReactDOM.createRoot(document.getElementById("root")!);

// Loaded per window kind, not up front: the selection overlay has no use for
// the annotation canvas or the settings UI, and those are the bulk of the
// bundle. Overlay windows sit in memory for the life of the app, so what they
// never load is memory never spent.
if (overlayMonitor !== null) {
  document.body.classList.add("overlay-body");
  import("./features/capture/CaptureOverlay").then(({ CaptureOverlay }) => {
    root.render(
      <React.StrictMode>
        <CaptureOverlay monitor={overlayMonitor} />
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
