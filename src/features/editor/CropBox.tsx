import { useRef } from "react";
import type { CropRect } from "../capture/AnnotationStage";

/** Fixed aspect ratios offered alongside a free-form crop. */
export const RATIOS: { id: string; label: string; value: number | null }[] = [
  { id: "free", label: "Free", value: null },
  { id: "original", label: "Original", value: 0 }, // resolved from the image
  { id: "1:1", label: "1:1", value: 1 },
  { id: "4:3", label: "4:3", value: 4 / 3 },
  { id: "3:2", label: "3:2", value: 3 / 2 },
  { id: "16:9", label: "16:9", value: 16 / 9 },
  { id: "9:16", label: "9:16", value: 9 / 16 },
];

const HANDLES = [
  { mode: "nw", cx: 0, cy: 0, cursor: "nwse-resize" },
  { mode: "n", cx: 0.5, cy: 0, cursor: "ns-resize" },
  { mode: "ne", cx: 1, cy: 0, cursor: "nesw-resize" },
  { mode: "e", cx: 1, cy: 0.5, cursor: "ew-resize" },
  { mode: "se", cx: 1, cy: 1, cursor: "nwse-resize" },
  { mode: "s", cx: 0.5, cy: 1, cursor: "ns-resize" },
  { mode: "sw", cx: 0, cy: 1, cursor: "nesw-resize" },
  { mode: "w", cx: 0, cy: 0.5, cursor: "ew-resize" },
];

const MIN = 16;

/** Largest rect of `ratio` that fits in the image, centred. */
export function fitRatio(imgW: number, imgH: number, ratio: number): CropRect {
  let w = imgW;
  let h = w / ratio;
  if (h > imgH) {
    h = imgH;
    w = h * ratio;
  }
  return { x: (imgW - w) / 2, y: (imgH - h) / 2, w, h };
}

/**
 * Crop rectangle with draggable edges, corners and interior. It starts as the
 * whole image and is pushed inward — cropping is nearly always trimming, so
 * asking the user to redraw the region they already captured is busywork.
 */
export function CropBox({
  crop,
  setCrop,
  imgW,
  imgH,
  scale,
  ratio,
  accent,
}: {
  crop: CropRect;
  setCrop: (r: CropRect) => void;
  imgW: number;
  imgH: number;
  scale: number;
  ratio: number | null;
  accent: string;
}) {
  const active = useRef(false);

  const startDrag = (mode: string) => (e: React.PointerEvent) => {
    if (e.button !== 0 || active.current) return;
    e.preventDefault();
    e.stopPropagation();
    active.current = true;
    const start = { x: e.clientX, y: e.clientY };
    const orig = { ...crop };

    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - start.x) / scale;
      const dy = (ev.clientY - start.y) / scale;
      setCrop(resize(orig, mode, dx, dy, imgW, imgH, ratio));
    };
    const up = () => {
      active.current = false;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const px = {
    left: crop.x * scale,
    top: crop.y * scale,
    width: crop.w * scale,
    height: crop.h * scale,
  };

  return (
    <>
      <div
        className="absolute z-20"
        style={{ ...px, cursor: "move" }}
        onPointerDown={startDrag("move")}
      />
      {HANDLES.map((h) => (
        <div
          key={h.mode}
          onPointerDown={startDrag(h.mode)}
          className="absolute z-30 rounded-full border-2 bg-white"
          style={{
            width: 12,
            height: 12,
            left: px.left + px.width * h.cx - 6,
            top: px.top + px.height * h.cy - 6,
            borderColor: accent,
            cursor: h.cursor,
            boxShadow: "0 1px 3px rgba(0,0,0,0.4)",
          }}
        />
      ))}
    </>
  );
}

function resize(
  orig: CropRect,
  mode: string,
  dx: number,
  dy: number,
  imgW: number,
  imgH: number,
  ratio: number | null,
): CropRect {
  if (mode === "move") {
    return {
      ...orig,
      x: clamp(orig.x + dx, 0, imgW - orig.w),
      y: clamp(orig.y + dy, 0, imgH - orig.h),
    };
  }

  let { x, y, w, h } = orig;
  if (mode.includes("w")) {
    const nx = clamp(orig.x + dx, 0, orig.x + orig.w - MIN);
    w = orig.x + orig.w - nx;
    x = nx;
  }
  if (mode.includes("e")) w = clamp(orig.w + dx, MIN, imgW - orig.x);
  if (mode.includes("n")) {
    const ny = clamp(orig.y + dy, 0, orig.y + orig.h - MIN);
    h = orig.y + orig.h - ny;
    y = ny;
  }
  if (mode.includes("s")) h = clamp(orig.h + dy, MIN, imgH - orig.y);

  if (ratio) {
    // Corners drive height from width; edges grow the perpendicular side
    // symmetrically so the box keeps its centre on that axis.
    const horizontal = mode === "e" || mode === "w";
    if (horizontal) {
      const nh = w / ratio;
      const cy = orig.y + orig.h / 2;
      y = clamp(cy - nh / 2, 0, Math.max(0, imgH - nh));
      h = Math.min(nh, imgH);
    } else if (mode === "n" || mode === "s") {
      const nw = h * ratio;
      const cx = orig.x + orig.w / 2;
      x = clamp(cx - nw / 2, 0, Math.max(0, imgW - nw));
      w = Math.min(nw, imgW);
    } else {
      let nw = w;
      let nh = nw / ratio;
      if (nh > imgH) {
        nh = imgH;
        nw = nh * ratio;
      }
      // Keep the corner opposite the one being dragged pinned.
      if (mode.includes("w")) x = orig.x + orig.w - nw;
      if (mode.includes("n")) y = orig.y + orig.h - nh;
      w = nw;
      h = nh;
      if (x < 0) {
        w += x;
        h = w / ratio;
        x = 0;
      }
      if (y < 0) {
        h += y;
        w = h * ratio;
        y = 0;
      }
    }
  }

  return {
    x: clamp(x, 0, imgW - MIN),
    y: clamp(y, 0, imgH - MIN),
    w: clamp(w, MIN, imgW - Math.max(0, x)),
    h: clamp(h, MIN, imgH - Math.max(0, y)),
  };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));
