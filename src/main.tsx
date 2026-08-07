import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "./styles.css";

const label = getCurrentWindow().label;
const OVERLAY_PREFIX = "overlay-";
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
