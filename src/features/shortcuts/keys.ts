/**
 * Keyboard-shortcut plumbing, kept free of React and Tauri so it can be
 * reasoned about — and tested — on its own.
 */

const MODIFIER_CODES = [
  "ControlLeft",
  "ControlRight",
  "AltLeft",
  "AltRight",
  "ShiftLeft",
  "ShiftRight",
  "MetaLeft",
  "MetaRight",
];

/**
 * Convert a KeyboardEvent into a canonical "Ctrl+Shift+A" string, or null
 * while only modifiers are held.
 *
 * The key comes from `event.code` — the physical key — not `event.key`, which
 * is whatever character the active layout produces. On a Thai layout the A key
 * reports a Thai character, and a shortcut recorded from that never matches
 * again once the layout changes.
 */
export function eventToShortcut(e: KeyboardEvent): string | null {
  const mods: string[] = [];
  if (e.ctrlKey) mods.push("Ctrl");
  if (e.altKey) mods.push("Alt");
  if (e.shiftKey) mods.push("Shift");
  if (e.metaKey) mods.push("Win");

  const code = e.code;
  if (MODIFIER_CODES.includes(code)) return null;

  let key: string;
  if (code.startsWith("Key")) key = code.slice(3);
  else if (code.startsWith("Digit")) key = code.slice(5);
  else key = code; // F1..F24, Space, Home, ArrowUp, PrintScreen, ...
  if (!key) return null;
  return [...mods, key].join("+");
}

const KEY_LABELS: Record<string, string> = {
  Comma: ",",
  Period: ".",
  Slash: "/",
  Semicolon: ";",
  Quote: "'",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  Minus: "-",
  Equal: "=",
  Backquote: "`",
  PrintScreen: "PrtSc",
};

/** Render W3C key codes the way a user reads them: "Comma" -> ",". */
export function humanize(shortcut: string): string {
  return shortcut
    .split("+")
    .map((p) => KEY_LABELS[p] ?? p)
    .join("+");
}

/**
 * Whether a combination is reasonable to claim system-wide.
 *
 * A bare letter would swallow that key in every other application, and
 * Shift+letter would break typing capitals. Function keys and PrintScreen are
 * the exception: nothing types them, so they are safe unmodified.
 */
export function isSafeGlobal(shortcut: string): boolean {
  const parts = shortcut.split("+");
  const key = parts[parts.length - 1];
  const mods = parts.slice(0, -1);
  if (/^F\d{1,2}$/.test(key) || key === "PrintScreen") return true;
  if (mods.length === 0) return false;
  return !(mods.length === 1 && mods[0] === "Shift");
}
