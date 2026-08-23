import { describe, expect, it } from "vitest";
import type { Ann, Settings } from "../../types";
import { rgbToHex } from "./eyedropper";
import {
  SIZE_SPECS,
  clampSize,
  getAnnSize,
  initialSizes,
  sizeKeyForAnn,
  sizeKeyForTool,
  withAnnSize,
} from "./sizes";

const defaults = {
  strokeWidth: 3,
  highlighterWidth: 14,
  fontSize: 18,
  counterSize: 28,
  blurStrength: 16,
  pixelSize: 12,
} as unknown as Settings["annotations"];

describe("clampSize", () => {
  it("holds a value inside its own spec", () => {
    expect(clampSize("stroke", 200)).toBe(SIZE_SPECS.stroke.max);
    expect(clampSize("stroke", 0)).toBe(SIZE_SPECS.stroke.min);
    expect(clampSize("counter", 32)).toBe(32);
  });

  it("falls back to the minimum rather than passing NaN through", () => {
    expect(clampSize("font", Number.NaN)).toBe(SIZE_SPECS.font.min);
  });
});

describe("initialSizes", () => {
  it("takes each size from its own saved default", () => {
    expect(initialSizes(defaults)).toEqual({
      stroke: 3,
      highlighter: 14,
      font: 18,
      counter: 28,
      blur: 16,
      pixel: 12,
    });
  });

  it("derives a highlighter width for settings files that predate it", () => {
    // The highlighter used to be drawn four times the stroke width.
    expect(initialSizes({ ...defaults, highlighterWidth: 0 }).highlighter).toBe(12);
  });
});

describe("size keys", () => {
  it("maps every drawing tool to the unit it draws in", () => {
    expect(sizeKeyForTool("arrow")).toBe("stroke");
    expect(sizeKeyForTool("highlighter")).toBe("highlighter");
    expect(sizeKeyForTool("text")).toBe("font");
    expect(sizeKeyForTool("counter")).toBe("counter");
    expect(sizeKeyForTool("pixelate")).toBe("pixel");
  });

  it("has no size for the tools that draw nothing", () => {
    expect(sizeKeyForTool("select")).toBeNull();
    expect(sizeKeyForTool("crop")).toBeNull();
    expect(sizeKeyForTool("eyedropper")).toBeNull();
  });
});

describe("annotation sizes", () => {
  const cases: { ann: Ann; size: number; resized: number }[] = [
    {
      ann: { id: "a", type: "arrow", points: [0, 0, 1, 1], color: "#fff", strokeWidth: 4 },
      size: 4,
      resized: 9,
    },
    {
      ann: {
        id: "b",
        type: "highlighter",
        points: [0, 0],
        color: "#fff",
        strokeWidth: 20,
        opacity: 0.35,
      },
      size: 20,
      resized: 9,
    },
    {
      ann: { id: "c", type: "text", x: 0, y: 0, text: "hi", color: "#fff", fontSize: 24 },
      size: 24,
      resized: 9,
    },
    {
      ann: { id: "d", type: "counter", x: 0, y: 0, n: 1, color: "#fff", size: 28 },
      size: 28,
      // The counter's minimum is larger than the others, so it clamps.
      resized: SIZE_SPECS.counter.min,
    },
    {
      ann: { id: "e", type: "blur", x: 0, y: 0, w: 4, h: 4, strength: 16 },
      size: 16,
      resized: 9,
    },
  ];

  it.each(cases)("reads and rewrites the size of a $ann.type", ({ ann, size, resized }) => {
    expect(getAnnSize(ann)).toBe(size);
    expect(getAnnSize(withAnnSize(ann, 9))).toBe(resized);
    // Resizing never changes what kind of thing it is.
    expect(sizeKeyForAnn(withAnnSize(ann, 9))).toBe(sizeKeyForAnn(ann));
  });
});

describe("rgbToHex", () => {
  it("formats a sampled pixel", () => {
    expect(rgbToHex(255, 59, 48)).toBe("#FF3B30");
    expect(rgbToHex(0, 0, 0)).toBe("#000000");
  });

  it("keeps out-of-range channels in bounds", () => {
    expect(rgbToHex(-5, 300, 127.6)).toBe("#00FF80");
  });
});
