/**
 * Shift-constrained drawing maths.
 *
 * Holding Shift means "keep it regular": 45° lines, perfect squares and
 * circles, axis-locked drags. The rules are shared by the arrow, line, pen,
 * highlighter, rectangle, ellipse, blur and pixelate tools, so they live here
 * rather than being re-derived at each call site.
 */

const STEP = Math.PI / 4;

/**
 * Snap the segment (x0,y0)→(x1,y1) to the nearest 45°, keeping its length.
 * Snapping the angle rather than the coordinates means the endpoint follows
 * the pointer's distance, so a line does not jump shorter as it rotates.
 */
export function snapToAngle(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): { x: number; y: number } {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const angle = Math.round(Math.atan2(dy, dx) / STEP) * STEP;
  const len = Math.hypot(dx, dy);
  return { x: x0 + Math.cos(angle) * len, y: y0 + Math.sin(angle) * len };
}

/**
 * Turn a dragged rectangle into a square, keeping the direction of the drag so
 * the corner under the pointer stays the corner that moves. The longer side
 * wins, which matches how the shape looked just before Shift went down.
 */
export function squareOf(w: number, h: number): { w: number; h: number } {
  const size = Math.max(Math.abs(w), Math.abs(h));
  return { w: Math.sign(w || 1) * size, h: Math.sign(h || 1) * size };
}

/**
 * Drop the smaller component of a drag so movement is locked to one axis.
 * A perfectly diagonal drag keeps the horizontal, which is the axis people
 * expect to win when nudging something into line.
 */
export function lockAxis(dx: number, dy: number): { dx: number; dy: number } {
  return Math.abs(dy) > Math.abs(dx) ? { dx: 0, dy } : { dx, dy: 0 };
}
