import { describe, expect, it } from "vitest";
import { eventToShortcut, humanize, isSafeGlobal } from "./keys";

/** A KeyboardEvent stand-in: only the fields the converter reads. */
const key = (code: string, mods: Partial<KeyboardEvent> = {}) =>
  ({ code, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...mods }) as KeyboardEvent;

describe("eventToShortcut", () => {
  it("builds the canonical modifier order", () => {
    // Ctrl, Alt, Shift, Win — always in that order, so two recordings of the
    // same combination compare equal.
    const s = eventToShortcut(
      key("KeyA", { ctrlKey: true, altKey: true, shiftKey: true, metaKey: true }),
    );
    expect(s).toBe("Ctrl+Alt+Shift+Win+A");
  });

  it("reads the physical key, not the character the layout produces", () => {
    // A Thai layout reports key "ฟ" for the same physical key; code does not
    // change, which is why the shortcut keeps working after switching layouts.
    expect(eventToShortcut(key("KeyA", { ctrlKey: true, shiftKey: true }))).toBe("Ctrl+Shift+A");
  });

  it("strips the Key and Digit prefixes", () => {
    expect(eventToShortcut(key("KeyZ", { ctrlKey: true }))).toBe("Ctrl+Z");
    expect(eventToShortcut(key("Digit5", { ctrlKey: true }))).toBe("Ctrl+5");
  });

  it("passes named codes through unchanged", () => {
    expect(eventToShortcut(key("F5"))).toBe("F5");
    expect(eventToShortcut(key("PrintScreen"))).toBe("PrintScreen");
    expect(eventToShortcut(key("Comma", { ctrlKey: true, shiftKey: true }))).toBe("Ctrl+Shift+Comma");
    expect(eventToShortcut(key("ArrowUp", { altKey: true }))).toBe("Alt+ArrowUp");
  });

  it("returns null while only modifiers are held", () => {
    // Otherwise the recorder would latch "Ctrl" the instant Ctrl went down,
    // before the user reached the real key.
    for (const code of [
      "ControlLeft",
      "ControlRight",
      "ShiftLeft",
      "ShiftRight",
      "AltLeft",
      "AltRight",
      "MetaLeft",
      "MetaRight",
    ]) {
      expect(eventToShortcut(key(code, { ctrlKey: true }))).toBeNull();
    }
  });
});

describe("humanize", () => {
  it("shows punctuation codes as the key on the keycap", () => {
    expect(humanize("Ctrl+Shift+Comma")).toBe("Ctrl+Shift+,");
    expect(humanize("Ctrl+Period")).toBe("Ctrl+.");
    expect(humanize("Ctrl+BracketLeft")).toBe("Ctrl+[");
    expect(humanize("Alt+Backquote")).toBe("Alt+`");
  });

  it("leaves ordinary keys alone", () => {
    expect(humanize("Ctrl+Shift+A")).toBe("Ctrl+Shift+A");
    expect(humanize("F5")).toBe("F5");
  });

  it("agrees with what the tray menu renders", () => {
    // The tray builds its own labels in Rust; a mismatch would show the same
    // shortcut two different ways in two places.
    expect(humanize("Ctrl+Shift+Comma")).toBe("Ctrl+Shift+,");
  });
});

describe("isSafeGlobal", () => {
  it("accepts combinations with a real modifier", () => {
    expect(isSafeGlobal("Ctrl+Shift+A")).toBe(true);
    expect(isSafeGlobal("Alt+A")).toBe(true);
    expect(isSafeGlobal("Win+A")).toBe(true);
  });

  it("rejects a bare key, which would swallow it system-wide", () => {
    expect(isSafeGlobal("A")).toBe(false);
    expect(isSafeGlobal("5")).toBe(false);
  });

  it("rejects Shift alone, which would break typing capitals", () => {
    expect(isSafeGlobal("Shift+A")).toBe(false);
  });

  it("allows function keys and PrintScreen unmodified", () => {
    expect(isSafeGlobal("F5")).toBe(true);
    expect(isSafeGlobal("F12")).toBe(true);
    expect(isSafeGlobal("PrintScreen")).toBe(true);
  });

  it("accepts Shift with a second modifier", () => {
    expect(isSafeGlobal("Ctrl+Shift+A")).toBe(true);
    expect(isSafeGlobal("Alt+Shift+A")).toBe(true);
  });
});
