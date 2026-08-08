import { describe, expect, it } from "vitest";
import { lockAxis, snapToAngle, squareOf } from "./geometry";

const close = (a: number, b: number) => expect(a).toBeCloseTo(b, 6);

describe("snapToAngle", () => {
  it("locks a near-horizontal drag to exactly horizontal", () => {
    const p = snapToAngle(0, 0, 100, 7);
    close(p.y, 0);
    expect(p.x).toBeGreaterThan(99);
  });

  it("locks a near-vertical drag to exactly vertical", () => {
    const p = snapToAngle(0, 0, 5, -100);
    close(p.x, 0);
    expect(p.y).toBeLessThan(-99);
  });

  it("keeps a diagonal at 45 degrees", () => {
    const p = snapToAngle(0, 0, 100, 80);
    close(Math.abs(p.x), Math.abs(p.y));
  });

  it("preserves the length of the drag", () => {
    // Snapping coordinates instead of the angle would shorten the line as it
    // rotates, which feels like the endpoint slipping out from under the cursor.
    const p = snapToAngle(0, 0, 100, 30);
    close(Math.hypot(p.x, p.y), Math.hypot(100, 30));
  });

  it("snaps relative to the start point, not the origin", () => {
    const p = snapToAngle(50, 50, 150, 57);
    close(p.y, 50);
    expect(p.x).toBeGreaterThan(149);
  });

  it("covers all eight directions", () => {
    for (const [dx, dy] of [
      [10, 1],
      [10, 9],
      [1, 10],
      [-1, 10],
      [-10, 9],
      [-10, 1],
      [-10, -9],
      [1, -10],
    ]) {
      const p = snapToAngle(0, 0, dx, dy);
      const angle = Math.atan2(p.y, p.x);
      const eighth = angle / (Math.PI / 4);
      close(eighth, Math.round(eighth));
    }
  });

  it("does not blow up on a zero-length drag", () => {
    const p = snapToAngle(20, 30, 20, 30);
    close(p.x, 20);
    close(p.y, 30);
  });
});

describe("squareOf", () => {
  it("takes the longer side", () => {
    expect(squareOf(100, 40)).toEqual({ w: 100, h: 100 });
    expect(squareOf(40, 100)).toEqual({ w: 100, h: 100 });
  });

  it("keeps the direction the user is dragging", () => {
    // Sign carries which way the rectangle grows; losing it would flip the
    // shape across the anchor corner as soon as Shift went down.
    expect(squareOf(-100, -40)).toEqual({ w: -100, h: -100 });
    expect(squareOf(-100, 40)).toEqual({ w: -100, h: 100 });
    expect(squareOf(100, -40)).toEqual({ w: 100, h: -100 });
  });

  it("treats a zero width as growing right rather than collapsing", () => {
    expect(squareOf(0, 60)).toEqual({ w: 60, h: 60 });
    expect(squareOf(0, -60)).toEqual({ w: 60, h: -60 });
  });

  it("returns a square for a square", () => {
    expect(squareOf(50, 50)).toEqual({ w: 50, h: 50 });
  });
});

describe("lockAxis", () => {
  it("keeps the dominant axis and zeroes the other", () => {
    expect(lockAxis(80, 10)).toEqual({ dx: 80, dy: 0 });
    expect(lockAxis(10, 80)).toEqual({ dx: 0, dy: 80 });
  });

  it("handles negative movement", () => {
    expect(lockAxis(-80, 10)).toEqual({ dx: -80, dy: 0 });
    expect(lockAxis(10, -80)).toEqual({ dx: 0, dy: -80 });
  });

  it("breaks a perfect diagonal toward horizontal", () => {
    expect(lockAxis(50, 50)).toEqual({ dx: 50, dy: 0 });
  });

  it("leaves a stationary drag alone", () => {
    expect(lockAxis(0, 0)).toEqual({ dx: 0, dy: 0 });
  });
});
