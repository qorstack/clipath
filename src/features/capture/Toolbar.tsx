import { useRef, useState } from "react";
import {
  Crop,
  MousePointer2,
  MoveUpRight,
  Minus,
  Square,
  Circle,
  PenLine,
  Highlighter,
  Type,
  Droplets,
  Grid3X3,
  Undo2,
  Redo2,
  Copy,
  Check,
  MoreHorizontal,
  Link,
  Pipette,
} from "lucide-react";
import type { FinalAction, Tool } from "../../types";
import type { SizeSpec } from "../editor/sizes";
import { ColorPopover } from "./ColorPopover";
import { SizePopover } from "./SizePopover";

const TOOL_DEFS: { tool: Tool; icon: React.ElementType; label: string; key: string }[] = [
  { tool: "select", icon: MousePointer2, label: "Select", key: "V" },
  { tool: "crop", icon: Crop, label: "Crop", key: "C" },
  { tool: "arrow", icon: MoveUpRight, label: "Arrow", key: "A" },
  { tool: "line", icon: Minus, label: "Line", key: "L" },
  { tool: "rect", icon: Square, label: "Rectangle", key: "R" },
  { tool: "ellipse", icon: Circle, label: "Ellipse", key: "O" },
  { tool: "pen", icon: PenLine, label: "Pen", key: "P" },
  { tool: "highlighter", icon: Highlighter, label: "Highlighter", key: "H" },
  { tool: "text", icon: Type, label: "Text", key: "T" },
  { tool: "blur", icon: Droplets, label: "Blur", key: "B" },
  { tool: "pixelate", icon: Grid3X3, label: "Pixelate", key: "X" },
];

export function Toolbar({
  tool,
  setTool,
  color,
  setColor,
  onCommitColor,
  onColorGestureStart,
  onPickFromImage,
  recentColors,
  size,
  onSize,
  onSizeGestureStart,
  displayScale,
  highlighterOpacity,
  canUndo,
  canRedo,
  undo,
  redo,
  showTooltips,
}: {
  tool: Tool;
  setTool: (t: Tool) => void;
  color: string;
  /** Applies a colour without recording it — used while one is being dragged. */
  setColor: (c: string) => void;
  /** Applies a colour and remembers it. */
  onCommitColor: (c: string) => void;
  /** Marks the start of a colour change, so a drag is one undo step. */
  onColorGestureStart: (force?: boolean) => void;
  onPickFromImage: () => void;
  recentColors: string[];
  /** The size the current tool — or the current selection — is measured in. */
  size: { spec: SizeSpec; value: number } | null;
  onSize: (v: number) => void;
  onSizeGestureStart: (force?: boolean) => void;
  displayScale: number;
  highlighterOpacity: number;
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;
  showTooltips: boolean;
}) {
  const [colorOpen, setColorOpen] = useState(false);
  const [sizeOpen, setSizeOpen] = useState(false);
  // Popovers hang off the wrapper rather than off their own button: the panel
  // sets backdrop-filter, which makes it a stacking context, and a popover
  // inside it is painted under the canvas no matter what its z-index says.
  // So the button's centre is measured when it opens and used as the anchor.
  const colorBtn = useRef<HTMLButtonElement | null>(null);
  const sizeBtn = useRef<HTMLButtonElement | null>(null);
  const [anchor, setAnchor] = useState({ color: 0, size: 0 });
  const centerOf = (el: HTMLElement | null) =>
    el ? el.offsetLeft + el.offsetWidth / 2 : 0;

  // The chip's dot is the real on-screen thickness, so the toolbar answers
  // "how big is this?" without anything having to be opened.
  const dot = size
    ? Math.max(3, Math.min(16, size.value * displayScale))
    : 3;

  return (
    <div className="relative">
      <div
        className="panel-shadow flex items-center gap-0.5 rounded-[13px] border px-1.5 py-1"
        style={{
          background: "var(--elevated)",
          borderColor: "var(--border)",
          backdropFilter: "blur(20px)",
        }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        {TOOL_DEFS.map(({ tool: t, icon: Icon, label, key }) => (
          <ToolButton
            key={t}
            active={tool === t}
            onClick={() => setTool(t)}
            title={showTooltips ? `${label} (${key})` : undefined}
          >
            <Icon size={16} strokeWidth={2} />
          </ToolButton>
        ))}
        <ToolButton
          active={tool === "counter"}
          onClick={() => setTool("counter")}
          title={showTooltips ? "Step Counter (N)" : undefined}
        >
          <span
            className="flex h-[16px] w-[16px] items-center justify-center rounded-full text-[10px] font-bold"
            style={{
              background: tool === "counter" ? "#fff" : "var(--text)",
              color: tool === "counter" ? "var(--accent)" : "var(--panel)",
            }}
          >
            1
          </span>
        </ToolButton>

        <div className="mx-1 h-5 w-px" style={{ background: "var(--border)" }} />

        <ToolButton
          active={tool === "eyedropper"}
          onClick={onPickFromImage}
          title={showTooltips ? "Pick Color from image (I)" : undefined}
        >
          <Pipette size={16} strokeWidth={2} />
        </ToolButton>

        <ToolButton
          btnRef={colorBtn}
          active={colorOpen}
          onClick={() => {
            setAnchor((a) => ({ ...a, color: centerOf(colorBtn.current) }));
            setColorOpen(!colorOpen);
            setSizeOpen(false);
          }}
          title={showTooltips ? `Color — ${color} (1–8)` : undefined}
        >
          <span
            className="h-[15px] w-[15px] rounded-full"
            style={{
              background: color,
              boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.2)",
            }}
          />
        </ToolButton>

        <button
          ref={sizeBtn}
          disabled={!size}
          title={
            showTooltips && size
              ? `${size.spec.label} — ${Math.round(size.value)} px ([ and ], or scroll here)`
              : undefined
          }
          aria-label={size ? size.spec.label : "Size"}
          onClick={() => {
            setAnchor((a) => ({ ...a, size: centerOf(sizeBtn.current) }));
            setSizeOpen(!sizeOpen);
            setColorOpen(false);
          }}
          onWheel={(e) => {
            if (!size) return;
            onSizeGestureStart();
            onSize(size.value - Math.sign(e.deltaY) * size.spec.step);
          }}
          className="flex h-[30px] items-center gap-1.5 rounded-[8px] px-2 transition-colors disabled:opacity-30"
          style={{
            background: sizeOpen ? "var(--accent)" : "transparent",
            color: sizeOpen ? "#fff" : "var(--text)",
          }}
          onMouseEnter={(e) => {
            if (!sizeOpen)
              (e.currentTarget as HTMLElement).style.background = "var(--control-hover)";
          }}
          onMouseLeave={(e) => {
            if (!sizeOpen)
              (e.currentTarget as HTMLElement).style.background = "transparent";
          }}
        >
          <span
            className="shrink-0 rounded-full"
            style={{
              background: sizeOpen ? "#fff" : "var(--text)",
              width: dot,
              height: dot,
            }}
          />
          <span className="text-[11px] font-semibold tabular-nums">
            {size ? Math.round(size.value) : "—"}
          </span>
        </button>

        <div className="mx-1 h-5 w-px" style={{ background: "var(--border)" }} />

        <ToolButton
          active={false}
          disabled={!canUndo}
          onClick={undo}
          title={showTooltips ? "Undo (Ctrl+Z)" : undefined}
        >
          <Undo2 size={16} />
        </ToolButton>
        <ToolButton
          active={false}
          disabled={!canRedo}
          onClick={redo}
          title={showTooltips ? "Redo (Ctrl+Y)" : undefined}
        >
          <Redo2 size={16} />
        </ToolButton>
      </div>

      {colorOpen && (
        <div
          className="absolute top-[calc(100%+6px)] z-50 -translate-x-1/2"
          style={{ left: anchor.color }}
        >
          <ColorPopover
            color={color}
            recent={recentColors}
            onPick={setColor}
            onCommit={onCommitColor}
            onGestureStart={onColorGestureStart}
            onPickFromImage={onPickFromImage}
            anchorRef={colorBtn}
            onClose={() => setColorOpen(false)}
          />
        </div>
      )}
      {sizeOpen && size && (
        <div
          className="absolute top-[calc(100%+6px)] z-50 -translate-x-1/2"
          style={{ left: anchor.size }}
        >
          <SizePopover
            spec={size.spec}
            value={size.value}
            color={color}
            displayScale={displayScale}
            highlighterOpacity={highlighterOpacity}
            onChange={onSize}
            onGestureStart={onSizeGestureStart}
            anchorRef={sizeBtn}
            onClose={() => setSizeOpen(false)}
          />
        </div>
      )}
    </div>
  );
}

function ToolButton({
  children,
  active,
  onClick,
  title,
  disabled,
  btnRef,
}: {
  children: React.ReactNode;
  active: boolean;
  onClick: () => void;
  title?: string;
  disabled?: boolean;
  btnRef?: React.MutableRefObject<HTMLButtonElement | null>;
}) {
  return (
    <button
      ref={btnRef}
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      className="flex h-[30px] w-[30px] items-center justify-center rounded-[8px] transition-colors disabled:opacity-30"
      style={{
        background: active ? "var(--accent)" : "transparent",
        color: active ? "#fff" : "var(--text)",
      }}
      onMouseEnter={(e) => {
        if (!active) (e.currentTarget as HTMLElement).style.background = "var(--control-hover)";
      }}
      onMouseLeave={(e) => {
        if (!active) (e.currentTarget as HTMLElement).style.background = "transparent";
      }}
    >
      {children}
    </button>
  );
}

export function ActionBar({
  onAction,
  onMore,
  moreOpen,
  showTooltips,
  busy,
}: {
  onAction: (a: FinalAction) => void;
  onMore: (action: string) => void;
  moreOpen: boolean;
  showTooltips: boolean;
  busy: boolean;
}) {
  const [open, setOpen] = useState(false);

  const MORE_ITEMS = [
    { id: "save-as", label: "Save As…" },
    { id: "open-folder", label: "Open in Folder" },
    { id: "copy-filename", label: "Copy Filename" },
    { id: "copy-folder", label: "Copy Folder Path" },
    { id: "delete", label: "Delete Capture" },
  ];

  return (
    <div className="relative">
      <div
        className="panel-shadow flex items-center gap-1 rounded-[13px] border px-1.5 py-1"
        style={{
          background: "var(--elevated)",
          borderColor: "var(--border)",
          backdropFilter: "blur(20px)",
        }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <button
          disabled={busy}
          onClick={() => onAction("copy-path")}
          className="flex h-[30px] items-center gap-1.5 rounded-[8px] px-3 text-[12.5px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          style={{ background: "var(--accent)" }}
          title={showTooltips ? "Copy the saved file path (Ctrl+C or Enter)" : undefined}
        >
          <Link size={14} strokeWidth={2.25} />
          Copy Path
        </button>
        <button
          disabled={busy}
          onClick={() => onAction("copy-image")}
          className="flex h-[30px] items-center gap-1.5 rounded-[8px] px-2.5 text-[12.5px] font-medium transition-colors disabled:opacity-50"
          style={{ color: "var(--text)" }}
          title={showTooltips ? "Copy the image to the clipboard (Ctrl+Shift+C)" : undefined}
          onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = "var(--control-hover)")}
          onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = "transparent")}
        >
          <Copy size={14} />
          Copy Image
        </button>
        <button
          disabled={busy}
          onClick={() => onAction("save")}
          className="flex h-[30px] items-center gap-1.5 rounded-[8px] px-2.5 text-[12.5px] font-medium transition-colors disabled:opacity-50"
          style={{ color: "var(--text)" }}
          title={
            showTooltips ? "Apply annotations to the file and close the window" : undefined
          }
          onMouseEnter={(e) =>
            ((e.currentTarget as HTMLElement).style.background = "var(--control-hover)")
          }
          onMouseLeave={(e) =>
            ((e.currentTarget as HTMLElement).style.background = "transparent")
          }
        >
          <Check size={15} strokeWidth={2.5} style={{ color: "var(--success)" }} />
          Save &amp; Close
        </button>
        <IconAction title={showTooltips ? "More" : undefined} disabled={busy} onClick={() => setOpen(!open)}>
          <MoreHorizontal size={16} />
        </IconAction>
      </div>
      {(open || moreOpen) && (
        // Opens upward: the action bar sits on the window's bottom edge, so
        // a menu dropping down would be clipped.
        <div
          className="panel-shadow absolute bottom-[calc(100%+6px)] right-0 z-50 min-w-[170px] rounded-[12px] border py-1"
          style={{
            background: "var(--elevated)",
            borderColor: "var(--border)",
            backdropFilter: "blur(20px)",
          }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {MORE_ITEMS.map((item) => (
            <button
              key={item.id}
              onClick={() => {
                setOpen(false);
                onMore(item.id);
              }}
              className="block w-full px-3 py-1.5 text-left text-[12.5px] transition-colors"
              style={{ color: item.id === "delete" ? "var(--destructive)" : "var(--text)" }}
              onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = "var(--control-hover)")}
              onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = "transparent")}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function IconAction({
  children,
  onClick,
  title,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title?: string;
  disabled?: boolean;
}) {
  return (
    <button
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      className="flex h-[30px] w-[30px] items-center justify-center rounded-[8px] transition-colors disabled:opacity-50"
      style={{ color: "var(--text)" }}
      onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = "var(--control-hover)")}
      onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = "transparent")}
    >
      {children}
    </button>
  );
}
