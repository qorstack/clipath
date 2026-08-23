/**
 * Colour sampling for the eyedropper.
 *
 * The editor's image is loaded from a blob: URL, so it is same-origin and a
 * canvas it is drawn into stays readable. Only the handful of pixels around the
 * cursor are ever copied — drawing a 4K screenshot into a scratch canvas on
 * every mouse move would cost tens of megabytes for one pixel of answer.
 */

/** Width of the sampled neighbourhood, in image pixels. Odd: it has a centre. */
export const LOUPE_CELLS = 13;

export function rgbToHex(r: number, g: number, b: number): string {
  const c = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n)))
      .toString(16)
      .padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`.toUpperCase();
}

let scratch: HTMLCanvasElement | null = null;
let scratchCtx: CanvasRenderingContext2D | null = null;

function context(): CanvasRenderingContext2D | null {
  if (!scratchCtx) {
    scratch = document.createElement("canvas");
    scratch.width = LOUPE_CELLS;
    scratch.height = LOUPE_CELLS;
    scratchCtx = scratch.getContext("2d", { willReadFrequently: true });
    if (scratchCtx) scratchCtx.imageSmoothingEnabled = false;
  }
  return scratchCtx;
}

export interface Sample {
  /** Colour under the cursor. */
  hex: string;
  /**
   * The neighbourhood, LOUPE_CELLS square. Reused between calls — blit it
   * before sampling again.
   */
  source: HTMLCanvasElement;
  cells: number;
}

/**
 * Sample the image at image-space (x, y), along with the pixels around it.
 * Returns null when the point is outside the image or the canvas is unreadable.
 */
export function sampleAround(
  image: HTMLImageElement,
  x: number,
  y: number,
): Sample | null {
  const w = image.naturalWidth;
  const h = image.naturalHeight;
  const px = Math.floor(x);
  const py = Math.floor(y);
  if (!w || !h || px < 0 || py < 0 || px >= w || py >= h) return null;

  const ctx = context();
  if (!ctx || !scratch) return null;
  const half = Math.floor(LOUPE_CELLS / 2);
  ctx.clearRect(0, 0, LOUPE_CELLS, LOUPE_CELLS);
  ctx.imageSmoothingEnabled = false;
  try {
    // A source rectangle that runs past the edge of the image is clipped, and
    // the destination is clipped by the same amount — so the pixels that do
    // exist still land in the right cells and the edge simply shows through.
    ctx.drawImage(
      image,
      px - half,
      py - half,
      LOUPE_CELLS,
      LOUPE_CELLS,
      0,
      0,
      LOUPE_CELLS,
      LOUPE_CELLS,
    );
    const d = ctx.getImageData(half, half, 1, 1).data;
    return { hex: rgbToHex(d[0], d[1], d[2]), source: scratch, cells: LOUPE_CELLS };
  } catch {
    // A tainted canvas would throw here rather than return a wrong colour.
    return null;
  }
}

/** Just the colour, for the click that ends a pick. */
export function samplePixel(
  image: HTMLImageElement,
  x: number,
  y: number,
): string | null {
  return sampleAround(image, x, y)?.hex ?? null;
}
