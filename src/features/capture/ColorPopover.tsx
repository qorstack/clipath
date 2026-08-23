import { useCallback, useEffect, useRef, useState } from "react";
import { Pipette } from "lucide-react";
import { PALETTE } from "../editor/palette";

function hsvToHex(h: number, s: number, v: number): string {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    const c = v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
    return Math.round(c * 255)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${f(5)}${f(3)}${f(1)}`.toUpperCase();
}

function hexToHsv(hex: string): [number, number, number] {
  const m = hex.replace("#", "");
  const r = parseInt(m.slice(0, 2), 16) / 255;
  const g = parseInt(m.slice(2, 4), 16) / 255;
  const b = parseInt(m.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === r) h = 60 * (((g - b) / d) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
  }
  if (h < 0) h += 360;
  return [h, max === 0 ? 0 : d / max, max];
}

export function ColorPopover({
  color,
  recent,
  onPick,
  onCommit,
  onGestureStart,
  onPickFromImage,
  anchorRef,
  onClose,
}: {
  color: string;
  recent: string[];
  /** The colour as it is being dragged. Applied, but not worth remembering. */
  onPick: (c: string) => void;
  /** The colour the user settled on. This is what goes into the recents. */
  onCommit: (c: string) => void;
  /** Called as a change begins, so the whole of it is one undo step. */
  onGestureStart: (force?: boolean) => void;
  onPickFromImage?: () => void;
  /** The button that opened this, so its own click is left to toggle. */
  anchorRef?: React.RefObject<HTMLElement | null>;
  onClose: () => void;
}) {
  const [custom, setCustom] = useState(false);
  const [hsv, setHsv] = useState<[number, number, number]>(() =>
    hexToHsv(/^#[0-9a-fA-F]{6}$/.test(color) ? color : "#FF3B30"),
  );
  const [hexInput, setHexInput] = useState(color.toUpperCase());
  const svRef = useRef<HTMLDivElement>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      // Closing on a press of the trigger too would fight the toggle: this
      // would close, then the click would open it straight back up.
      if (anchorRef?.current?.contains(target)) return;
      if (ref.current && !ref.current.contains(target)) onClose();
    };
    window.addEventListener("pointerdown", handler, true);
    return () => window.removeEventListener("pointerdown", handler, true);
  }, [onClose, anchorRef]);

  /**
   * The colour being tuned in the custom picker, if there is one.
   *
   * Arriving at a custom colour means dragging the square, then the hue, then
   * the square again. Recording each of those would leave the recents holding
   * several shades of one colour — the same row-wiping problem as recording
   * every frame, only slower. The whole run is one choice, and it is recorded
   * when the user is finished with it: the picker closing, or another swatch
   * being taken instead.
   *
   * It is a ref rather than state because `hsv` lags a fast drag by a frame,
   * and what gets recorded has to be the colour that ended up on screen.
   */
  const pending = useRef<string | null>(null);
  const commitRef = useRef(onCommit);
  commitRef.current = onCommit;

  const flush = useCallback(() => {
    const hex = pending.current;
    pending.current = null;
    if (hex) commitRef.current(hex);
  }, []);

  // Closing the picker ends whatever run was in progress.
  useEffect(() => flush, [flush]);

  const applyHsv = (next: [number, number, number]) => {
    setHsv(next);
    const hex = hsvToHex(next[0], next[1], next[2]);
    pending.current = hex;
    setHexInput(hex);
    onPick(hex);
  };

  const handleSv = (e: React.PointerEvent) => {
    const el = svRef.current!;
    onGestureStart(true);
    const move = (ev: PointerEvent | React.PointerEvent) => {
      const rect = el.getBoundingClientRect();
      const s = Math.min(1, Math.max(0, (ev.clientX - rect.left) / rect.width));
      const v = 1 - Math.min(1, Math.max(0, (ev.clientY - rect.top) / rect.height));
      applyHsv([hsvRef.current[0], s, v]);
    };
    move(e);
    const up = () => {
      window.removeEventListener("pointermove", move as any);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move as any);
    window.addEventListener("pointerup", up);
  };

  const hsvRef = useRef(hsv);
  hsvRef.current = hsv;

  const hueColor = hsvToHex(hsv[0], 1, 1);

  return (
    <div
      ref={ref}
      className="panel-shadow rounded-[12px] border p-3"
      style={{
        background: "var(--elevated)",
        borderColor: "var(--border)",
        width: 208,
        backdropFilter: "blur(20px)",
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="grid grid-cols-8 gap-1.5">
        {PALETTE.map((c) => (
          <button
            key={c}
            onClick={() => {
              flush();
              onGestureStart(true);
              onCommit(c);
              onClose();
            }}
            className="h-5 w-5 rounded-full transition-transform hover:scale-115"
            style={{
              background: c,
              boxShadow:
                color.toUpperCase() === c
                  ? "0 0 0 2px var(--elevated), 0 0 0 3.5px var(--accent)"
                  : c === "#FFFFFF"
                    ? "inset 0 0 0 1px rgba(0,0,0,0.2)"
                    : "none",
            }}
          />
        ))}
      </div>
      {recent.length > 0 && (
        <div className="mt-2 flex gap-1.5">
          {recent.slice(0, 8).map((c) => (
            <button
              key={c}
              onClick={() => {
                flush();
                onGestureStart(true);
                onCommit(c);
                onClose();
              }}
              className="h-4 w-4 rounded-full transition-transform hover:scale-115"
              style={{
                background: c,
                boxShadow:
                  color.toUpperCase() === c.toUpperCase()
                    ? "0 0 0 2px var(--elevated), 0 0 0 3.5px var(--accent)"
                    : "inset 0 0 0 1px rgba(0,0,0,0.15)",
              }}
              title={c}
            />
          ))}
        </div>
      )}
      <div className="mt-2.5 flex gap-1.5">
        <button
          className="flex-1 rounded-[7px] py-1 text-[12px] font-medium"
          style={{
            background: custom ? "var(--accent)" : "var(--control)",
            color: custom ? "#fff" : "var(--text)",
          }}
          onClick={() => {
            if (custom) flush();
            setCustom(!custom);
          }}
        >
          Custom Color
        </button>
        {onPickFromImage && (
          <button
            title="Pick a colour from the image (I)"
            aria-label="Pick a colour from the image"
            className="flex h-[26px] w-[30px] shrink-0 items-center justify-center rounded-[7px]"
            style={{ background: "var(--control)", color: "var(--text)" }}
            onClick={() => {
              onPickFromImage();
              onClose();
            }}
          >
            <Pipette size={14} />
          </button>
        )}
      </div>
      {custom && (
        <div className="mt-2.5">
          <div
            ref={svRef}
            onPointerDown={handleSv}
            className="relative h-[110px] w-full cursor-crosshair rounded-[8px]"
            style={{
              background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${hueColor})`,
            }}
          >
            <div
              className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow"
              style={{ left: `${hsv[1] * 100}%`, top: `${(1 - hsv[2]) * 100}%` }}
            />
          </div>
          <input
            type="range"
            min={0}
            max={360}
            value={hsv[0]}
            onChange={(e) => applyHsv([Number(e.target.value), hsv[1], hsv[2]])}
            onPointerDown={() => onGestureStart(true)}
            onKeyDown={() => onGestureStart()}
            className="mt-2 h-2.5 w-full appearance-none rounded-full"
            style={{
              background:
                "linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)",
            }}
          />
          <div className="mt-2 flex items-center gap-2">
            <div
              className="h-6 w-6 shrink-0 rounded-full"
              style={{
                background: hexInput,
                boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.15)",
              }}
            />
            <input
              type="text"
              value={hexInput}
              spellCheck={false}
              onChange={(e) => {
                const v = e.target.value.toUpperCase();
                setHexInput(v);
                if (/^#[0-9A-F]{6}$/.test(v)) {
                  onGestureStart();
                  setHsv(hexToHsv(v));
                  pending.current = v;
                  onPick(v);
                }
              }}
              className="w-full font-mono !py-1 text-[12px]"
            />
          </div>
        </div>
      )}
    </div>
  );
}
