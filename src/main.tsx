import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "./styles.css";
import { MainWindow } from "./app/MainWindow";
import { CaptureOverlay } from "./features/capture/CaptureOverlay";

const label = getCurrentWindow().label;
const OVERLAY_PREFIX = "overlay-";

let content: React.ReactNode;
if (label.startsWith(OVERLAY_PREFIX)) {
  // overlay-{monitor}
  document.body.classList.add("overlay-body");
  content = <CaptureOverlay monitor={Number(label.slice(OVERLAY_PREFIX.length))} />;
} else {
  content = <MainWindow />;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>{content}</React.StrictMode>,
);
