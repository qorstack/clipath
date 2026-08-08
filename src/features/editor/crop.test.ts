import { describe, expect, it } from "vitest";
import { RATIOS, fitRatio, resize } from "./CropBox";
import { TOOL_KEYS } from "./keymap";

const IMG = { w: 1000, h: 800 };
const full = () => ({ x: 0, y: 0, w: IMG.w, h: IMG.h });
const free = (r: ReturnType<typeof full>, mode: string, dx: number, dy: number) =>
  resize(r, mode, dx, dy, IMG.w, IMG.h, null);

const inside = (r: { x: number; y: number; w: number; h: number }) =>
  r.x >= 0 && r.y >= 0 && r.x + r.w <= IMG.w + 1e-6 && r.y + r.h <= IMG.h + 1e-6;

describe("crop edges", () => {
  it("pulls the left edge inward without moving the right one", () => {
    const r = free(full(), "w", 200, 0);
    expect(r.x).toBeCloseTo(200);
    expect(r.x + r.w).toBeCloseTo(IMG.w);
  });

  it("pulls the right edge inward without moving the left one", () => {
    const r = free(full(), "e", -300, 0);
    expect(r.x).toBeCloseTo(0);
    expect(r.w).toBeCloseTo(700);
  });

  it("pulls top and bottom independently", () => {
    const top = free(full(), "n", 0, 100);
    expect(top.y).toBeCloseTo(100);
    expect(top.y + top.h).toBeCloseTo(IMG.h);

    const bottom = free(full(), "s", 0, -100);
    expect(bottom.y).toBeCloseTo(0);
    expect(bottom.h).toBeCloseTo(700);
  });

  it("moves two edges at once from a corner", () => {
    const r = free(full(), "nw", 100, 50);
    expect(r.x).toBeCloseTo(100);
    expect(r.y).toBeCloseTo(50);
    expect(r.x + r.w).toBeCloseTo(IMG.w);
    expect(r.y + r.h).toBeCloseTo(IMG.h);
  });

  it("never lets an edge past the image bounds", () => {
    for (const mode of ["n", "s", "e", "w", "nw", "ne", "se", "sw"]) {
      for (const [dx, dy] of [[-5000, -5000], [5000, 5000], [5000, -5000]]) {
        const r = free(full(), mode, dx, dy);
        expect(inside(r), `${mode} by ${dx},${dy} -> ${JSON.stringify(r)}`).toBe(true);
      }
    }
  });

  it("never collapses the box to nothing", () => {
    // A zero-area crop would be applied and destroy the capture.
    for (const mode of ["n", "s", "e", "w", "nw", "ne", "se", "sw"]) {
      const r = free(full(), mode, 5000, 5000);
      expect(r.w).toBeGreaterThan(0);
      expect(r.h).toBeGreaterThan(0);
    }
  });

  it("never lets an edge cross the one opposite it", () => {
    const r = free({ x: 100, y: 100, w: 200, h: 200 }, "w", 5000, 0);
    expect(r.w).toBeGreaterThan(0);
    expect(r.x).toBeLessThanOrEqual(300);
  });
});

describe("crop move", () => {
  it("slides the box without resizing it", () => {
    const start = { x: 100, y: 100, w: 200, h: 150 };
    const r = resize(start, "move", 50, -40, IMG.w, IMG.h, null);
    expect(r.w).toBeCloseTo(200);
    expect(r.h).toBeCloseTo(150);
    expect(r.x).toBeCloseTo(150);
    expect(r.y).toBeCloseTo(60);
  });

  it("stops at the image edge instead of sliding off", () => {
    const start = { x: 100, y: 100, w: 200, h: 150 };
    const r = resize(start, "move", 5000, 5000, IMG.w, IMG.h, null);
    expect(r.x + r.w).toBeCloseTo(IMG.w);
    expect(r.y + r.h).toBeCloseTo(IMG.h);

    const back = resize(start, "move", -5000, -5000, IMG.w, IMG.h, null);
    expect(back.x).toBeCloseTo(0);
    expect(back.y).toBeCloseTo(0);
  });
});

describe("aspect ratio presets", () => {
  it("fits the largest centred rectangle of the requested shape", () => {
    const square = fitRatio(1000, 800, 1);
    expect(square.w).toBeCloseTo(800);
    expect(square.h).toBeCloseTo(800);
    expect(square.x).toBeCloseTo(100);
    expect(square.y).toBeCloseTo(0);
  });

  it("fits a wide ratio against the width", () => {
    const wide = fitRatio(1000, 800, 16 / 9);
    expect(wide.w).toBeCloseTo(1000);
    expect(wide.h).toBeCloseTo(562.5);
    expect(wide.y).toBeCloseTo((800 - 562.5) / 2);
  });

  it("fits a tall ratio against the height", () => {
    const tall = fitRatio(1000, 800, 9 / 16);
    expect(tall.h).toBeCloseTo(800);
    expect(tall.w).toBeCloseTo(450);
  });

  it("holds the ratio while a corner is dragged", () => {
    const r = resize(full(), "se", -400, -20, IMG.w, IMG.h, 1);
    expect(r.w / r.h).toBeCloseTo(1, 3);
    expect(inside(r)).toBe(true);
  });

  it("holds the ratio while an edge is dragged", () => {
    const r = resize(full(), "e", -500, 0, IMG.w, IMG.h, 16 / 9);
    expect(r.w / r.h).toBeCloseTo(16 / 9, 3);
    expect(inside(r)).toBe(true);
  });

  it("keeps a ratio crop inside the image from every handle", () => {
    for (const ratio of [1, 4 / 3, 3 / 2, 16 / 9, 9 / 16]) {
      for (const mode of ["n", "s", "e", "w", "nw", "ne", "se", "sw"]) {
        const r = resize(full(), mode, -350, -250, IMG.w, IMG.h, ratio);
        expect(inside(r), `${ratio} ${mode} -> ${JSON.stringify(r)}`).toBe(true);
      }
    }
  });

  it("offers Free plus the presets the toolbar renders", () => {
    expect(RATIOS[0]).toMatchObject({ id: "free", value: null });
    expect(RATIOS.map((r) => r.id)).toEqual([
      "free",
      "original",
      "1:1",
      "4:3",
      "3:2",
      "16:9",
      "9:16",
    ]);
  });
});

describe("tool shortcuts", () => {
  it("keys every tool off a physical code", () => {
    // event.key would carry a Thai character on a Thai layout and match none
    // of these; every entry must be a KeyboardEvent.code name.
    for (const code of Object.keys(TOOL_KEYS)) {
      expect(code).toMatch(/^Key[A-Z]$/);
    }
  });

  it("binds each key to exactly one tool", () => {
    const tools = Object.values(TOOL_KEYS);
    expect(new Set(tools).size).toBe(tools.length);
  });

  it("covers every drawing tool the toolbar shows", () => {
    const bound = new Set(Object.values(TOOL_KEYS));
    for (const tool of [
      "select",
      "crop",
      "arrow",
      "line",
      "rect",
      "ellipse",
      "pen",
      "highlighter",
      "text",
      "blur",
      "pixelate",
      "counter",
    ]) {
      expect(bound.has(tool as never), `${tool} has no shortcut`).toBe(true);
    }
  });
});
