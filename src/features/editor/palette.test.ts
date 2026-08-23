import { describe, expect, it } from "vitest";
import { PALETTE, RECENT_LIMIT, isPaletteColor, rememberColor } from "./palette";

describe("rememberColor", () => {
  it("keeps the colours the palette does not already offer", () => {
    expect(rememberColor([], "#123456")).toEqual(["#123456"]);
  });

  it("ignores every palette colour, so the row never mirrors the row above it", () => {
    let recent: string[] = [];
    for (const c of PALETTE) recent = rememberColor(recent, c);
    expect(recent).toEqual([]);
  });

  it("ignores a palette colour whatever case it arrives in", () => {
    expect(rememberColor([], "#ff3b30")).toEqual([]);
  });

  it("stores a colour uppercased, so one colour never occupies two slots", () => {
    const once = rememberColor([], "#abcdef");
    expect(once).toEqual(["#ABCDEF"]);
    expect(rememberColor(once, "#AbCdEf")).toEqual(["#ABCDEF"]);
  });

  it("moves a colour already held to the front instead of repeating it", () => {
    const recent = ["#111111", "#222222", "#333333"];
    expect(rememberColor(recent, "#333333")).toEqual([
      "#333333",
      "#111111",
      "#222222",
    ]);
  });

  it("drops the oldest colour once the row is full", () => {
    let recent: string[] = [];
    for (let i = 0; i < RECENT_LIMIT + 3; i++) {
      recent = rememberColor(recent, `#0000${i.toString(16).padStart(2, "0")}`);
    }
    expect(recent).toHaveLength(RECENT_LIMIT);
    expect(recent[0]).toBe("#00000A");
    expect(recent).not.toContain("#000000");
  });

  it("refuses anything that is not a six-digit hex", () => {
    expect(rememberColor([], "red")).toEqual([]);
    expect(rememberColor([], "#FFF")).toEqual([]);
    expect(rememberColor(["#ABCDEF"], "")).toEqual(["#ABCDEF"]);
  });
});

describe("isPaletteColor", () => {
  it("recognises every palette entry regardless of case", () => {
    for (const c of PALETTE) expect(isPaletteColor(c.toLowerCase())).toBe(true);
  });

  it("does not claim a colour the palette lacks", () => {
    expect(isPaletteColor("#123456")).toBe(false);
  });
});
