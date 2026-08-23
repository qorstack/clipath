import { useEffect, useRef, useState } from "react";
import type { SizeSpec } from "../editor/sizes";
import { contrastText } from "./AnnotationStage";

/**
 * The size control, with the value drawn at the size it will actually appear.
 * A number alone says nothing about how thick "8" is on this particular
 * capture, so the preview is rendered at the on-screen size — `displayScale`
 * being how much the stage is shrunk to fit the window.
 */
export function SizePopover({
  spec,
  value,
  color,
  displayScale,
  highlighterOpacity,
  onChange,
  onGestureStart,
  anchorRef,
  onClose,
}: {
  spec: SizeSpec;
  value: number;
  color: string;
  displayScale: number;
  highlighterOpacity: number;
  onChange: (v: number) => void;
  onGestureStart: (force?: boolean) => void;
  /** The button that opened this, so its own click is left to toggle. */
  anchorRef?: React.RefObject<HTMLElement | null>;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [text, setText] = useState(String(Math.round(value)));

  useEffect(() => setText(String(Math.round(value))), [value]);

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

  const onScreen = value * displayScale;

  return (
    <div
      ref={ref}
      className="panel-shadow rounded-[12px] border p-3"
      style={{
        background: "var(--elevated)",
        borderColor: "var(--border)",
        width: 236,
        backdropFilter: "blur(20px)",
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="flex items-baseline justify-between">
        <span className="text-[12px] font-semibold">{spec.label}</span>
        <span className="text-[11px] tabular-nums" style={{ color: "var(--text-2)" }}>
          {displayScale < 0.995
            ? `${Math.round(value)} px · ${Math.round(onScreen)} px here`
            : `${Math.round(value)} px`}
        </span>
      </div>

      <div
        className="mt-2 flex h-[62px] items-center justify-center overflow-hidden rounded-[9px] border"
        style={{
          borderColor: "var(--border)",
          background:
            "repeating-conic-gradient(rgba(128,128,128,0.16) 0% 25%, transparent 0% 50%) 50% / 12px 12px",
        }}
      >
        <SizePreview
          spec={spec}
          onScreen={onScreen}
          color={color}
          highlighterOpacity={highlighterOpacity}
        />
      </div>

      <input
        type="range"
        min={spec.min}
        max={spec.max}
        step={spec.step}
        value={value}
        onPointerDown={() => onGestureStart(true)}
        onKeyDown={() => onGestureStart()}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-2.5 w-full"
        style={{ accentColor: "var(--accent)" }}
      />

      <div className="mt-1.5 flex items-center gap-1.5">
        {spec.presets.map((p) => (
          <button
            key={p}
            onClick={() => {
              onGestureStart(true);
              onChange(p);
            }}
            className="h-[24px] flex-1 rounded-[7px] text-[11px] font-semibold tabular-nums transition-colors"
            style={{
              background: Math.round(value) === p ? "var(--accent)" : "var(--control)",
              color: Math.round(value) === p ? "#fff" : "var(--text)",
            }}
          >
            {p}
          </button>
        ))}
        <input
          type="text"
          inputMode="numeric"
          value={text}
          spellCheck={false}
          onChange={(e) => {
            setText(e.target.value);
            const n = Number(e.target.value);
            if (Number.isFinite(n) && e.target.value.trim() !== "") {
              onGestureStart();
              onChange(n);
            }
          }}
          onKeyDown={(e) => e.stopPropagation()}
          className="w-[46px] !py-[3px] text-center text-[11px] tabular-nums"
        />
      </div>
    </div>
  );
}

function SizePreview({
  spec,
  onScreen,
  color,
  highlighterOpacity,
}: {
  spec: SizeSpec;
  onScreen: number;
  color: string;
  highlighterOpacity: number;
}) {
  // The preview box is 62px tall; anything larger is shown clipped to it rather
  // than allowed to blow the popover open.
  const d = Math.max(1, Math.min(50, onScreen));

  switch (spec.key) {
    case "stroke":
      return (
        <svg width={188} height={54} aria-hidden>
          <line
            x1={12}
            y1={27}
            x2={140}
            y2={27}
            stroke={color}
            strokeWidth={d}
            strokeLinecap="round"
          />
          <circle cx={168} cy={27} r={d / 2} fill={color} />
        </svg>
      );
    case "highlighter":
      return (
        <svg width={188} height={54} aria-hidden>
          <line
            x1={16}
            y1={27}
            x2={172}
            y2={27}
            stroke={color}
            strokeOpacity={highlighterOpacity}
            strokeWidth={d}
            strokeLinecap="round"
          />
        </svg>
      );
    case "font":
      return (
        <span
          style={{
            color,
            fontSize: d,
            fontWeight: 600,
            lineHeight: 1,
            fontFamily: '"Inter", "Segoe UI", system-ui, sans-serif',
          }}
        >
          Ag 12
        </span>
      );
    case "counter":
      return (
        <span
          className="flex items-center justify-center rounded-full font-bold"
          style={{
            width: d,
            height: d,
            background: color,
            color: contrastText(color),
            fontSize: Math.max(7, d * 0.5),
            boxShadow: "inset 0 0 0 1.5px rgba(255,255,255,0.9)",
          }}
        >
          1
        </span>
      );
    case "pixel":
      return (
        <span
          className="h-[46px] w-[170px] rounded-[4px]"
          style={{
            backgroundImage:
              "linear-gradient(45deg, rgba(0,0,0,0.55) 25%, transparent 25% 75%, rgba(0,0,0,0.55) 75%), linear-gradient(45deg, rgba(0,0,0,0.55) 25%, transparent 25% 75%, rgba(0,0,0,0.55) 75%)",
            backgroundSize: `${d}px ${d}px, ${d}px ${d}px`,
            backgroundPosition: `0 0, ${d / 2}px ${d / 2}px`,
            backgroundColor: "rgba(255,255,255,0.5)",
          }}
        />
      );
    case "blur":
    default:
      return (
        <span
          className="h-[46px] w-[170px] overflow-hidden rounded-[4px]"
          style={{
            backgroundImage:
              "repeating-linear-gradient(90deg, #1c1c1e 0 14px, #f2f2f7 14px 28px)",
            filter: `blur(${Math.max(0.5, d / 4)}px)`,
          }}
        />
      );
  }
}
