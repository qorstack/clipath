import { describe, expect, it } from "vitest";
import { exportPixelRatio, exportedWidth } from "./exportScale";

/** How the editor lays the stage out: whole CSS pixels. */
const stageWidthFor = (natural: number, displayScale: number) =>
  Math.round(natural * displayScale);

describe("export scale", () => {
  it("returns a saved image the same width as the capture", () => {
    for (const natural of [640, 639, 1001, 1920, 2559, 333]) {
      for (const displayScale of [1, 0.5, 0.37, 0.8125, 0.66, 0.9]) {
        const stage = stageWidthFor(natural, displayScale);
        const out = exportedWidth(stage, exportPixelRatio(natural, stage));
        expect(out, `${natural}px at scale ${displayScale}`).toBe(natural);
      }
    }
  });

  it("covers the case the old formula got wrong", () => {
    // 640 laid out at 0.37 gives a 237px stage; 237 / 0.37 rounds to 641 —
    // and other combinations round the other way, to 639.
    const natural = 640;
    const displayScale = 0.37;
    const stage = stageWidthFor(natural, displayScale);
    expect(Math.round(stage / displayScale)).not.toBe(natural);
    expect(exportedWidth(stage, exportPixelRatio(natural, stage))).toBe(natural);
  });

  it("does not divide by a stage that has not been laid out yet", () => {
    expect(exportPixelRatio(640, 0)).toBe(1);
  });
});
