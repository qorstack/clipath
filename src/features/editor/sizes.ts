import type { Ann, Settings, Tool } from "../../types";

/**
 * Every annotation carries a size, but each kind measures it in its own units:
 * a stroke has a width, text has a font size, a counter has a diameter, blur
 * has a radius. The toolbar shows one size control regardless, so the kinds are
 * named here and the control is driven by whichever one the current tool — or
 * the current selection — happens to use.
 */
export type SizeKey = "stroke" | "highlighter" | "font" | "counter" | "blur" | "pixel";

export interface SizeSpec {
  key: SizeKey;
  label: string;
  min: number;
  max: number;
  step: number;
  /** Quick-pick values, offered as chips beside the slider. */
  presets: number[];
}

export const SIZE_SPECS: Record<SizeKey, SizeSpec> = {
  stroke: {
    key: "stroke",
    label: "Stroke width",
    min: 1,
    max: 24,
    step: 1,
    presets: [1, 2, 4, 8, 14],
  },
  highlighter: {
    key: "highlighter",
    label: "Highlighter width",
    min: 4,
    max: 80,
    step: 1,
    presets: [8, 14, 22, 36, 56],
  },
  font: {
    key: "font",
    label: "Text size",
    min: 8,
    max: 96,
    step: 1,
    presets: [12, 18, 24, 36, 56],
  },
  counter: {
    key: "counter",
    label: "Counter size",
    min: 14,
    max: 96,
    step: 1,
    presets: [18, 24, 32, 48, 64],
  },
  blur: {
    key: "blur",
    label: "Blur strength",
    min: 2,
    max: 60,
    step: 1,
    presets: [6, 12, 20, 32, 48],
  },
  pixel: {
    key: "pixel",
    label: "Pixel size",
    min: 2,
    max: 60,
    step: 1,
    presets: [4, 8, 14, 24, 40],
  },
};

export type SizeMap = Record<SizeKey, number>;

export function clampSize(key: SizeKey, value: number): number {
  const spec = SIZE_SPECS[key];
  if (!Number.isFinite(value)) return spec.min;
  const stepped = Math.round(value / spec.step) * spec.step;
  return Math.min(spec.max, Math.max(spec.min, stepped));
}

/** The sizes an editor session starts with, taken from the saved defaults. */
export function initialSizes(a: Settings["annotations"]): SizeMap {
  return {
    stroke: clampSize("stroke", a.strokeWidth),
    // Older settings files predate the highlighter having its own width; they
    // used four times the stroke, so fall back to that rather than to nothing.
    highlighter: clampSize("highlighter", a.highlighterWidth || a.strokeWidth * 4),
    font: clampSize("font", a.fontSize),
    counter: clampSize("counter", a.counterSize),
    blur: clampSize("blur", a.blurStrength),
    pixel: clampSize("pixel", a.pixelSize),
  };
}

/** Which size the tool is about to draw with, or null if it draws nothing. */
export function sizeKeyForTool(tool: Tool): SizeKey | null {
  switch (tool) {
    case "arrow":
    case "line":
    case "rect":
    case "ellipse":
    case "pen":
      return "stroke";
    case "highlighter":
      return "highlighter";
    case "text":
      return "font";
    case "counter":
      return "counter";
    case "blur":
      return "blur";
    case "pixelate":
      return "pixel";
    default:
      return null;
  }
}

/** Which size an existing annotation is measured in. */
export function sizeKeyForAnn(ann: Ann): SizeKey {
  switch (ann.type) {
    case "highlighter":
      return "highlighter";
    case "text":
      return "font";
    case "counter":
      return "counter";
    case "blur":
      return "blur";
    case "pixelate":
      return "pixel";
    default:
      return "stroke";
  }
}

export function getAnnSize(ann: Ann): number {
  switch (ann.type) {
    case "text":
      return ann.fontSize;
    case "counter":
      return ann.size;
    case "blur":
    case "pixelate":
      return ann.strength;
    default:
      return ann.strokeWidth;
  }
}

/** Return the annotation resized, in whichever unit its kind uses. */
export function withAnnSize(ann: Ann, value: number): Ann {
  const v = clampSize(sizeKeyForAnn(ann), value);
  switch (ann.type) {
    case "text":
      return { ...ann, fontSize: v };
    case "counter":
      return { ...ann, size: v };
    case "blur":
    case "pixelate":
      return { ...ann, strength: v };
    default:
      return { ...ann, strokeWidth: v };
  }
}

/** Blur and pixelate are made of the image itself, so they have no colour. */
export function annHasColor(ann: Ann): boolean {
  return "color" in ann;
}
