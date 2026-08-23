import { useEffect, useRef, useState } from "react";
import type { Tool } from "../../types";
import { contrastText } from "../capture/AnnotationStage";
import { LOUPE_CELLS, sampleAround } from "./eyedropper";
import type { SizeKey } from "./sizes";

/**
 * A ghost of what the next stroke will look like, drawn under the pointer.
 *
 * Without it the only way to learn how thick a line or how big a counter is
 * going to be is to draw one and undo it. The ghost is rendered at the on-screen
 * size — annotations are stored in image pixels and the stage is scaled to fit,
 * so a 12px stroke on a downscaled capture is not 12px on screen.
 *
 * The pointer is tracked inside this component rather than in the editor: a
 * position in editor state would re-render the whole Konva stage on every mouse
 * move, for a cursor that is pure decoration.
 */
export function CanvasCursor({
  hostRef,
  tool,
  sizeKey,
  value,
  color,
  displayScale,
  highlighterOpacity,
  nextCounter,
  image,
  bounds,
  disabled,
}: {
  hostRef: React.RefObject<HTMLDivElement | null>;
  tool: Tool;
  sizeKey: SizeKey | null;
  value: number;
  color: string;
  displayScale: number;
  highlighterOpacity: number;
  nextCounter: number;
  image: HTMLImageElement | null;
  bounds: { w: number; h: number };
  disabled?: boolean;
}) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    let raf = 0;
    let flushed = 0;
    let last = { x: 0, y: 0 };
    const flush = () => {
      raf = 0;
      flushed = performance.now();
      setPos({ ...last });
    };
    const move = (e: MouseEvent) => {
      const r = el.getBoundingClientRect();
      last = { x: e.clientX - r.left, y: e.clientY - r.top };
      if (!raf) {
        raf = requestAnimationFrame(flush);
      } else if (performance.now() - flushed > 60) {
        // Frame callbacks stall in a window Chromium believes is hidden, which
        // this one can briefly be after the screen wakes. Flush directly rather
        // than leaving the ghost frozen a screen away from the pointer.
        flush();
      }
    };
    const leave = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      setPos(null);
    };
    el.addEventListener("mousemove", move);
    el.addEventListener("mouseleave", leave);
    return () => {
      el.removeEventListener("mousemove", move);
      el.removeEventListener("mouseleave", leave);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [hostRef]);

  if (disabled || !pos) return null;
  if (tool === "select" || tool === "crop") return null;

  if (tool === "eyedropper") {
    return <Loupe image={image} pos={pos} bounds={bounds} />;
  }
  if (!sizeKey) return null;

  // On-screen size. Below a couple of pixels a ring is invisible, so the ghost
  // stops shrinking before the real stroke does — the number keeps the truth.
  const d = Math.max(2, value * displayScale);
  const label = `${Math.round(value)} px`;

  return (
    <div
      className="pointer-events-none absolute z-40"
      style={{ left: pos.x, top: pos.y }}
    >
      <Ghost
        tool={tool}
        sizeKey={sizeKey}
        d={d}
        color={color}
        highlighterOpacity={highlighterOpacity}
        nextCounter={nextCounter}
      />
      <span
        className="absolute whitespace-nowrap rounded-full px-1.5 py-[1px] text-[10px] font-semibold tabular-nums"
        style={{
          left: d / 2 + 8,
          top: d / 2 + 4,
          background: "rgba(20,20,22,0.78)",
          color: "#fff",
          textShadow: "none",
        }}
      >
        {label}
      </span>
    </div>
  );
}

function Ghost({
  tool,
  sizeKey,
  d,
  color,
  highlighterOpacity,
  nextCounter,
}: {
  tool: Tool;
  sizeKey: SizeKey;
  d: number;
  color: string;
  highlighterOpacity: number;
  nextCounter: number;
}) {
  const centered: React.CSSProperties = {
    position: "absolute",
    left: 0,
    top: 0,
    transform: "translate(-50%, -50%)",
  };
  const ring = "0 0 0 1px rgba(255,255,255,0.9), 0 0 0 2px rgba(0,0,0,0.35)";

  if (sizeKey === "counter") {
    return (
      <span
        style={{
          ...centered,
          width: d,
          height: d,
          borderRadius: "50%",
          background: color,
          opacity: 0.6,
          boxShadow: ring,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: contrastText(color),
          fontSize: Math.max(7, d * 0.5),
          fontWeight: 700,
          lineHeight: 1,
        }}
      >
        {nextCounter}
      </span>
    );
  }

  if (sizeKey === "font") {
    return (
      <span
        style={{
          ...centered,
          transform: "translate(0, -50%)",
          color,
          opacity: 0.65,
          fontSize: d,
          fontWeight: 600,
          lineHeight: 1,
          textShadow: "0 1px 3px rgba(0,0,0,0.45)",
          borderLeft: "1px solid rgba(128,128,128,0.7)",
          paddingLeft: 2,
        }}
      >
        Ag
      </span>
    );
  }

  if (sizeKey === "pixel") {
    // The size is the block edge, so a single block is the honest preview.
    return (
      <span
        style={{
          ...centered,
          width: d,
          height: d,
          background: "rgba(255,255,255,0.18)",
          boxShadow: ring,
        }}
      />
    );
  }

  if (sizeKey === "blur") {
    return (
      <span
        style={{
          ...centered,
          width: d,
          height: d,
          borderRadius: "50%",
          background: "rgba(255,255,255,0.35)",
          filter: `blur(${Math.max(1, d / 6)}px)`,
          boxShadow: "0 0 0 1px rgba(255,255,255,0.5)",
        }}
      />
    );
  }

  // Stroke-based tools: a dot the exact width of the line they will draw.
  const highlighter = tool === "highlighter";
  return (
    <span
      style={{
        ...centered,
        width: d,
        height: d,
        borderRadius: highlighter ? Math.min(4, d / 3) : "50%",
        background: color,
        opacity: highlighter ? highlighterOpacity : 0.75,
        boxShadow: ring,
      }}
    />
  );
}

const LOUPE_PX = 8 * LOUPE_CELLS;

/** Magnified pixels under the cursor, plus the hex that a click would take. */
function Loupe({
  image,
  pos,
  bounds,
}: {
  image: HTMLImageElement | null;
  pos: { x: number; y: number };
  bounds: { w: number; h: number };
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [hex, setHex] = useState<string | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !image) return;
    // The loupe shows image pixels, and the stage may be scaled, so convert
    // back before sampling.
    const sx = (pos.x / bounds.w) * image.naturalWidth;
    const sy = (pos.y / bounds.h) * image.naturalHeight;
    const s = sampleAround(image, sx, sy);
    if (!s) {
      setHex(null);
      return;
    }
    setHex(s.hex);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(s.source, 0, 0, s.cells, s.cells, 0, 0, canvas.width, canvas.height);
    const cell = canvas.width / s.cells;
    const c = Math.floor(s.cells / 2) * cell;
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(0,0,0,0.85)";
    ctx.strokeRect(c - 1, c - 1, cell + 2, cell + 2);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "#fff";
    ctx.strokeRect(c, c, cell, cell);
  }, [image, pos.x, pos.y, bounds.w, bounds.h]);

  // Flip the loupe to the other side of the pointer near the edges so it never
  // covers the pixel being picked or spills off the image.
  const flipX = pos.x > bounds.w - (LOUPE_PX + 40);
  const flipY = pos.y > bounds.h - (LOUPE_PX + 56);

  return (
    <div
      className="pointer-events-none absolute z-40"
      style={{
        left: pos.x + (flipX ? -(LOUPE_PX + 22) : 18),
        top: pos.y + (flipY ? -(LOUPE_PX + 46) : 18),
      }}
    >
      <div
        className="overflow-hidden rounded-[10px] border"
        style={{
          borderColor: "rgba(255,255,255,0.85)",
          boxShadow: "0 4px 16px rgba(0,0,0,0.45), 0 0 0 1px rgba(0,0,0,0.4)",
          background: "#111",
        }}
      >
        <canvas ref={ref} width={LOUPE_PX} height={LOUPE_PX} className="block" />
        <div
          className="flex items-center gap-1.5 px-1.5 py-1"
          style={{ background: "rgba(20,20,22,0.92)" }}
        >
          <span
            className="h-3 w-3 shrink-0 rounded-full"
            style={{
              background: hex ?? "transparent",
              boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.5)",
            }}
          />
          <span className="font-mono text-[10.5px] font-semibold text-white">
            {hex ?? "—"}
          </span>
        </div>
      </div>
    </div>
  );
}
