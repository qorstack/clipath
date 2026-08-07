import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "./styles.css";
import { MainWindow } from "./app/MainWindow";
import { CaptureOverlay } from "./features/capture/CaptureOverlay";
import { PinView } from "./features/pin/PinView";

const label = getCurrentWindow().label;

let content: React.ReactNode;
if (label.startsWith("overlay-")) {
  // overlay-{session}-{monitor}
  document.body.classList.add("overlay-body");
  content = <CaptureOverlay monitor={Number(label.split("-")[2] ?? 0)} />;
} else if (label.startsWith("pin-")) {
  document.body.classList.add("pin-body");
  content = <PinView label={label} />;
} else {
  content = <MainWindow />;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>{content}</React.StrictMode>,
);
