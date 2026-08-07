import { useEffect, useRef, useState } from "react";

const PALETTE = [
  "#FF3B30", // red
  "#FF9500", // orange
  "#FFCC00", // yellow
  "#34C759", // green
  "#0A84FF", // blue
  "#BF5AF2", // purple
  "#FFFFFF", // white
  "#000000", // black
];

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
  onClose,
}: {
  color: string;
  recent: string[];
  onPick: (c: string) => void;
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
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener("pointerdown", handler, true);
    return () => window.removeEventListener("pointerdown", handler, true);
  }, [onClose]);

  const applyHsv = (next: [number, number, number]) => {
    setHsv(next);
    const hex = hsvToHex(next[0], next[1], next[2]);
    setHexInput(hex);
    onPick(hex);
  };

  const handleSv = (e: React.PointerEvent) => {
    const el = svRef.current!;
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
      className="panel-shadow absolute z-50 rounded-[12px] border p-3"
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
              onPick(c);
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
                onPick(c);
                onClose();
              }}
              className="h-4 w-4 rounded-full"
              style={{ background: c, boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.15)" }}
              title={c}
            />
          ))}
        </div>
      )}
      <button
        className="mt-2.5 w-full rounded-[7px] py-1 text-[12px] font-medium"
        style={{ background: "var(--control)", color: "var(--text)" }}
        onClick={() => setCustom(!custom)}
      >
        Custom Color
      </button>
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
                  setHsv(hexToHsv(v));
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
