/**
 * Overlay window labels, kept in one place because both sides of the app read
 * them: Rust builds the window under this label, and the page it loads works
 * out which monitor it is from nothing else.
 *
 * The label carries a generation suffix — `overlay-1-g4` — because destroying
 * a window only asks the event loop to destroy it, so rebuilding under the old
 * label collides with the window on its way out. Anything reading the label
 * must therefore take the *first* segment, not everything after the prefix.
 */
export const OVERLAY_PREFIX = "overlay-";

export function isOverlayLabel(label: string): boolean {
  return monitorOf(label) !== null;
}

/** Monitor index carried by an overlay label, or null if it isn't one. */
export function monitorOf(label: string): number | null {
  if (!label.startsWith(OVERLAY_PREFIX)) return null;
  const first = label.slice(OVERLAY_PREFIX.length).split("-")[0];
  if (!/^\d+$/.test(first)) return null;
  return Number(first);
}
