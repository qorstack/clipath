export type Tool =
  | "select"
  | "crop"
  | "arrow"
  | "line"
  | "rect"
  | "ellipse"
  | "pen"
  | "highlighter"
  | "text"
  | "blur"
  | "pixelate"
  | "counter";

export type FinalAction = "copy-path" | "copy-image" | "save" | "pin";

export interface Settings {
  schemaVersion: number;
  onboardingCompleted: boolean;
  general: {
    launchAtStartup: boolean;
    minimizeToTray: boolean;
    notifications: boolean;
    captureSound: boolean;
  };
  capture: {
    defaultMode: string;
    freezeScreen: boolean;
    showDimensions: boolean;
    showMagnifier: boolean;
    crosshairGuides: boolean;
    rememberPreviousRegion: boolean;
  };
  annotations: {
    defaultTool: Tool;
    defaultColor: string;
    strokeWidth: number;
    penSmoothing: boolean;
    highlighterOpacity: number;
    fontSize: number;
    blurStrength: number;
    pixelSize: number;
    counterSize: number;
    counterStart: number;
    rememberLastTool: boolean;
    rememberLastColor: boolean;
    showTooltips: boolean;
  };
  output: {
    folder: string;
    filenamePattern: string;
    format: "png" | "jpeg" | "webp";
    quality: number;
    defaultFinalAction: FinalAction;
    pathFormat: string;
  };
  shortcuts: {
    region: string | null;
    fullscreen: string | null;
    activeWindow: string | null;
    previousRegion: string | null;
    copyLastPath: string | null;
    openFolder: string | null;
    openSettings: string | null;
  };
  appearance: {
    theme: "system" | "light" | "dark";
    accent: string;
  };
  recent: {
    keepList: boolean;
    limit: number;
  };
}

export interface MonitorInfo {
  index: number;
  x: number;
  y: number;
  width: number;
  height: number;
  scale: number;
  isPrimary: boolean;
}

export interface OverlayData {
  monitor: MonitorInfo;
  settings: Settings;
}

export interface RecentItem {
  path: string;
  filename: string;
  modified: number;
}

// ---------------------------------------------------------------------------
// Annotation object model
// ---------------------------------------------------------------------------

interface AnnBase {
  id: string;
}

export interface ArrowAnn extends AnnBase {
  type: "arrow" | "line";
  points: [number, number, number, number];
  color: string;
  strokeWidth: number;
}

export interface ShapeAnn extends AnnBase {
  type: "rect" | "ellipse";
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  strokeWidth: number;
  fill: "none" | "translucent" | "solid";
}

export interface StrokeAnn extends AnnBase {
  type: "pen" | "highlighter";
  points: number[];
  color: string;
  strokeWidth: number;
  opacity: number;
}

export interface TextAnn extends AnnBase {
  type: "text";
  x: number;
  y: number;
  text: string;
  color: string;
  fontSize: number;
}

export interface FxAnn extends AnnBase {
  type: "blur" | "pixelate";
  x: number;
  y: number;
  w: number;
  h: number;
  strength: number;
}

export interface CounterAnn extends AnnBase {
  type: "counter";
  x: number;
  y: number;
  n: number;
  color: string;
  size: number;
}

export type Ann = ArrowAnn | ShapeAnn | StrokeAnn | TextAnn | FxAnn | CounterAnn;
