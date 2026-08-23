/** The eight colours the picker always offers, in the order they are shown. */
export const PALETTE = [
  "#FF3B30", // red
  "#FF9500", // orange
  "#FFCC00", // yellow
  "#34C759", // green
  "#0A84FF", // blue
  "#BF5AF2", // purple
  "#FFFFFF", // white
  "#000000", // black
];

/** How many colours the recents row holds. One row, same width as the palette. */
export const RECENT_LIMIT = 8;

export function isPaletteColor(hex: string): boolean {
  return PALETTE.includes(hex.toUpperCase());
}

/**
 * Add a colour the user settled on to the recents, newest first.
 *
 * Two rules, both there because breaking either makes the row useless:
 *
 * - A palette colour is never recorded. Those eight are one row above, and a
 *   recents row that mirrored them offered a second way to click the same
 *   swatch while pushing out the custom colours the row exists to hold.
 * - A colour already held moves to the front rather than being added again,
 *   so the row never spends two slots on one colour.
 *
 * What is *not* handled here is when to call it. Every frame of a drag through
 * the colour square is a real colour change, and recording each one wipes the
 * whole row in a single gesture — so this is called once, on the colour left
 * behind when the gesture ends.
 */
export function rememberColor(recent: string[], color: string): string[] {
  const hex = color.toUpperCase();
  if (!/^#[0-9A-F]{6}$/.test(hex) || isPaletteColor(hex)) return recent;
  return [hex, ...recent.filter((c) => c.toUpperCase() !== hex)].slice(0, RECENT_LIMIT);
}
