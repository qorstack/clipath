import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { ipc } from "../../lib/ipc";
import type { MonitorInfo, Settings } from "../../types";

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

type Phase = "waiting" | "idle" | "dragging" | "committing";

/**
 * Region selection only. The window is created once at startup and reused for
 * every capture — booting a WebView per capture was the bulk of the delay
 * between pressing the shortcut and seeing the selection UI.
 *
 * Once a region is committed the backend saves it and opens the editor.
 */
export function CaptureOverlay({ monitor }: { monitor: number }) {
  const [phase, setPhase] = useState<Phase>("waiting");
  const [info, setInfo] = useState<MonitorInfo | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [sel, setSel] = useState<Rect | null>(null);
  const [cursor, setCursor] = useState({ x: 0, y: 0 });

  const bitmapRef = useRef<ImageBitmap | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const pending = useRef<{ x: number; y: number; shift: boolean } | null>(null);
  const rafId = useRef(0);

  const scale = info?.scale ?? 1;

  // ---- session start -------------------------------------------------------
  const begin = useCallback(async () => {
    const d = await ipc.getOverlayInfo(monitor);
    setInfo(d.monitor);
    setSettings(d.settings);
    setSel(null);
    dragStart.current = null;

    const buf = await ipc.getOverlayFrame(monitor);
    // Raw RGBA straight into an ImageBitmap: no encoder, no decoder.
    const data = new ImageData(
      new Uint8ClampedArray(buf),
      d.monitor.width,
      d.monitor.height,
    );
    bitmapRef.current?.close();
    bitmapRef.current = await createImageBitmap(data);

    const canvas = canvasRef.current;
    if (canvas) {
      canvas.width = d.monitor.width;
      canvas.height = d.monitor.height;
      canvas.getContext("2d")?.drawImage(bitmapRef.current, 0, 0);
    }
    setPhase("idle");
    await ipc.overlayReady(monitor);
  }, [monitor]);

  useEffect(() => {
    // A session may already be running when this window first mounts.
    begin().catch(() => setPhase("waiting"));
    const un = listen<number>("capture-start", () => {
      begin().catch((e) => console.error(e));
    });
    return () => {
      un.then((f) => f());
    };
  }, [begin]);

  // Theme for the instruction pill / magnifier chrome
  useEffect(() => {
    if (!settings) return;
    const t = settings.appearance.theme;
    const dark =
      t === "dark" ||
      (t === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.classList.toggle("dark", dark);
    document.documentElement.style.setProperty("--accent", settings.appearance.accent);
  }, [settings]);

  // ---- pointer handling (rAF-throttled so dragging stays at display rate) --
  const flush = useCallback(() => {
    rafId.current = 0;
    const p = pending.current;
    if (!p) return;
    setCursor({ x: p.x, y: p.y });
    const start = dragStart.current;
    if (!start) return;
    let ex = p.x;
    let ey = p.y;
    if (p.shift) {
      const dx = ex - start.x;
      const dy = ey - start.y;
      const m = Math.max(Math.abs(dx), Math.abs(dy));
      ex = start.x + Math.sign(dx || 1) * m;
      ey = start.y + Math.sign(dy || 1) * m;
    }
    setSel({
      x: Math.min(start.x, ex),
      y: Math.min(start.y, ey),
      w: Math.abs(ex - start.x),
      h: Math.abs(ey - start.y),
    });
  }, []);

  const onMove = (e: React.PointerEvent) => {
    pending.current = { x: e.clientX, y: e.clientY, shift: e.shiftKey };
    if (!rafId.current) rafId.current = requestAnimationFrame(flush);
  };

  const onDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || phase !== "idle") return;
    dragStart.current = { x: e.clientX, y: e.clientY };
    setSel({ x: e.clientX, y: e.clientY, w: 0, h: 0 });
    setPhase("dragging");
  };

  const commit = useCallback(
    async (r: Rect) => {
      setPhase("committing");
      const px = Math.round(r.x * scale);
      const py = Math.round(r.y * scale);
      const pw = Math.max(1, Math.round(r.w * scale));
      const ph = Math.max(1, Math.round(r.h * scale));
      try {
        await ipc.commitRegion(monitor, px, py, pw, ph);
      } catch (e) {
        console.error(e);
        setPhase("idle");
      }
    },
    [monitor, scale],
  );

  const onUp = () => {
    if (phase !== "dragging") return;
    dragStart.current = null;
    if (sel && sel.w >= 4 && sel.h >= 4) commit(sel);
    else {
      setPhase("idle");
      setSel(null);
    }
  };

  // ---- keyboard ------------------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        ipc.cancelCapture().catch(console.error);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => () => cancelAnimationFrame(rafId.current), []);

  const busy = phase === "committing";
  const showChrome = phase === "idle" || phase === "dragging";
  const dims = sel && {
    w: Math.round(sel.w * scale),
    h: Math.round(sel.h * scale),
  };

  return (
    <div
      className="relative h-screen w-screen overflow-hidden"
      style={{ cursor: showChrome ? "crosshair" : "default" }}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onContextMenu={(e) => e.preventDefault()}
    >
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />

      {/* Scrim as four rects rather than one huge box-shadow: far cheaper to
          repaint while dragging. */}
      {showChrome &&
        (sel ? (
          <>
            <Scrim style={{ left: 0, top: 0, width: "100%", height: sel.y }} />
            <Scrim
              style={{ left: 0, top: sel.y + sel.h, width: "100%", bottom: 0 }}
            />
            <Scrim style={{ left: 0, top: sel.y, width: sel.x, height: sel.h }} />
            <Scrim
              style={{ left: sel.x + sel.w, top: sel.y, right: 0, height: sel.h }}
            />
            <div
              className="pointer-events-none absolute"
              style={{
                left: sel.x,
                top: sel.y,
                width: sel.w,
                height: sel.h,
                outline: "1px solid rgba(255,255,255,0.9)",
              }}
            />
          </>
        ) : (
          <Scrim style={{ inset: 0 }} />
        ))}

      {settings?.capture.crosshairGuides && phase === "idle" && (
        <>
          <div
            className="pointer-events-none absolute h-full w-px"
            style={{ left: cursor.x, background: "rgba(255,255,255,0.35)" }}
          />
          <div
            className="pointer-events-none absolute w-full"
            style={{ top: cursor.y, height: 1, background: "rgba(255,255,255,0.35)" }}
          />
        </>
      )}

      {phase === "idle" && (
        <div
          className="pointer-events-none absolute left-1/2 top-6 -translate-x-1/2 rounded-full px-4 py-1.5 text-[12.5px] font-medium text-white"
          style={{ background: "rgba(20,20,22,0.72)" }}
        >
          Drag to capture&ensp;•&ensp;Shift for a square&ensp;•&ensp;Esc to cancel
        </div>
      )}

      {sel && settings?.capture.showDimensions && showChrome && dims && (
        <div
          className="pointer-events-none absolute rounded-[6px] px-2 py-0.5 text-[11.5px] font-medium tabular-nums text-white"
          style={{
            left: sel.x,
            top: sel.y > 26 ? sel.y - 24 : sel.y + 4,
            background: "rgba(20,20,22,0.72)",
          }}
        >
          {dims.w} × {dims.h}
        </div>
      )}

      {settings?.capture.showMagnifier && showChrome && (
        <Magnifier cursor={cursor} bitmapRef={bitmapRef} scale={scale} />
      )}

      {busy && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div
            className="rounded-full px-4 py-1.5 text-[12.5px] font-medium text-white"
            style={{ background: "rgba(20,20,22,0.8)" }}
          >
            Saving…
          </div>
        </div>
      )}
    </div>
  );
}

function Scrim({ style }: { style: React.CSSProperties }) {
  return (
    <div
      className="pointer-events-none absolute"
      style={{ background: "rgba(0,0,0,0.35)", ...style }}
    />
  );
}

const MAG_SIZE = 128;
const MAG_ZOOM = 8;

function Magnifier({
  cursor,
  bitmapRef,
  scale,
}: {
  cursor: { x: number; y: number };
  bitmapRef: React.RefObject<ImageBitmap | null>;
  scale: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const bitmap = bitmapRef.current;
    if (!canvas || !bitmap) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const src = MAG_SIZE / MAG_ZOOM;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, MAG_SIZE, MAG_SIZE);
    ctx.drawImage(
      bitmap,
      cursor.x * scale - src / 2,
      cursor.y * scale - src / 2,
      src,
      src,
      0,
      0,
      MAG_SIZE,
      MAG_SIZE,
    );
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.lineWidth = 1;
    ctx.strokeRect(
      MAG_SIZE / 2 - MAG_ZOOM / 2,
      MAG_SIZE / 2 - MAG_ZOOM / 2,
      MAG_ZOOM,
      MAG_ZOOM,
    );
  }, [cursor, bitmapRef, scale]);

  const left =
    cursor.x + 24 + MAG_SIZE > window.innerWidth ? cursor.x - MAG_SIZE - 24 : cursor.x + 24;
  const top =
    cursor.y + 24 + MAG_SIZE + 22 > window.innerHeight
      ? cursor.y - MAG_SIZE - 44
      : cursor.y + 24;

  return (
    <div
      className="pointer-events-none absolute z-40 overflow-hidden rounded-[12px]"
      style={{
        left,
        top,
        width: MAG_SIZE,
        boxShadow: "0 8px 28px rgba(0,0,0,.3), 0 0 0 1px rgba(255,255,255,.25)",
      }}
    >
      <canvas ref={ref} width={MAG_SIZE} height={MAG_SIZE} className="block" />
      <div
        className="px-2 py-0.5 text-center text-[10.5px] font-medium tabular-nums text-white"
        style={{ background: "rgba(20,20,22,0.85)" }}
      >
        {Math.round(cursor.x * scale)}, {Math.round(cursor.y * scale)}
      </div>
    </div>
  );
}
