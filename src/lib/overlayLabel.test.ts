import { describe, expect, it } from "vitest";
import { isOverlayLabel, monitorOf } from "./overlayLabel";

describe("overlay labels", () => {
  it("reads the monitor out of a generation-suffixed label", () => {
    // Reading everything after the prefix gives Number("0-g0") === NaN, and an
    // overlay with a NaN monitor asks the backend for nothing and never
    // appears — the shortcut simply looks dead.
    expect(monitorOf("overlay-0-g0")).toBe(0);
    expect(monitorOf("overlay-1-g12")).toBe(1);
    expect(monitorOf("overlay-2-g7")).toBe(2);
  });

  it("still reads a label with no generation at all", () => {
    expect(monitorOf("overlay-3")).toBe(3);
  });

  it("does not mistake other windows for overlays", () => {
    expect(monitorOf("main")).toBeNull();
    expect(monitorOf("editor")).toBeNull();
    expect(monitorOf("overlay-")).toBeNull();
    expect(monitorOf("overlay-x-g1")).toBeNull();
    expect(isOverlayLabel("main")).toBe(false);
    expect(isOverlayLabel("overlay-0-g0")).toBe(true);
  });
});
