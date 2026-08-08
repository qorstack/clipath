import { describe, expect, it } from "vitest";
import { deepMerge } from "./merge";

describe("deepMerge", () => {
  it("keeps sibling keys a shallow merge would drop", () => {
    // Settings are written back whole: losing a sibling here silently resets
    // it to whatever the Rust default is.
    const base = { general: { a: 1, b: 2, c: 3 } };
    expect(deepMerge(base, { general: { b: 9 } })).toEqual({
      general: { a: 1, b: 9, c: 3 },
    });
  });

  it("merges several levels down", () => {
    const base = { a: { b: { c: 1, d: 2 } }, e: 3 };
    expect(deepMerge(base, { a: { b: { c: 9 } } })).toEqual({
      a: { b: { c: 9, d: 2 } },
      e: 3,
    });
  });

  it("does not mutate the object it was given", () => {
    const base = { a: { b: 1 } };
    deepMerge(base, { a: { b: 2 } });
    expect(base.a.b).toBe(1);
  });

  it("replaces arrays instead of merging them element by element", () => {
    // Merging index-by-index would leave stale trailing entries behind.
    const base = { colors: ["red", "green", "blue"] };
    expect(deepMerge(base, { colors: ["black"] } as never)).toEqual({
      colors: ["black"],
    });
  });

  it("writes null through rather than treating it as an object", () => {
    const base = { shortcuts: { region: "Ctrl+Shift+A" } };
    expect(deepMerge(base, { shortcuts: { region: null } } as never)).toEqual({
      shortcuts: { region: null },
    });
  });

  it("can set a key that was previously null", () => {
    const base = { shortcuts: { region: null } };
    expect(deepMerge(base, { shortcuts: { region: "Alt+F9" } } as never)).toEqual({
      shortcuts: { region: "Alt+F9" },
    });
  });

  it("leaves the base untouched for an empty patch", () => {
    const base = { a: 1, b: { c: 2 } };
    expect(deepMerge(base, {})).toEqual(base);
  });

  it("carries booleans through, including false", () => {
    // `value || fallback` style merging would flip false back to true.
    const base = { general: { notifications: true, minimizeToTray: true } };
    expect(deepMerge(base, { general: { notifications: false } })).toEqual({
      general: { notifications: false, minimizeToTray: true },
    });
  });

  it("carries zero through", () => {
    const base = { annotations: { strokeWidth: 3 } };
    expect(deepMerge(base, { annotations: { strokeWidth: 0 } })).toEqual({
      annotations: { strokeWidth: 0 },
    });
  });
});
