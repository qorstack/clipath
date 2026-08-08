import type { Tool } from "../../types";

/**
 * Editor tool shortcuts, keyed by physical key position rather than by the
 * character produced. Reading `event.key` breaks every shortcut the moment the
 * keyboard layout is not Latin — on a Thai layout the T key reports "ะ" and
 * matches nothing.
 */
export const TOOL_KEYS: Record<string, Tool> = {
  KeyV: "select",
  KeyC: "crop",
  KeyA: "arrow",
  KeyL: "line",
  KeyR: "rect",
  KeyO: "ellipse",
  KeyP: "pen",
  KeyH: "highlighter",
  KeyT: "text",
  KeyB: "blur",
  KeyX: "pixelate",
  KeyN: "counter",
};
