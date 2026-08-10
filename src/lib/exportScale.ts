/**
 * The ratio Konva must render the stage at to reproduce the source image
 * exactly.
 *
 * The stage is laid out at `round(naturalWidth * displayScale)` CSS pixels, so
 * scaling it back up by `1 / displayScale` does not return to the original
 * width — the rounding is already lost. Every save through the editor shaved a
 * column off the capture that way (a 640px selection came back 639px wide).
 * Dividing by the stage's real width cancels exactly instead.
 */
export function exportPixelRatio(naturalWidth: number, stageWidth: number): number {
  if (stageWidth <= 0) return 1;
  return naturalWidth / stageWidth;
}

/** What Konva writes out: the stage width scaled and rounded to whole pixels. */
export function exportedWidth(stageWidth: number, pixelRatio: number): number {
  return Math.round(stageWidth * pixelRatio);
}
