import Konva from "konva";
import { useEffect, useRef, useState } from "react";
import {
  Stage,
  Layer,
  Image as KImage,
  Arrow,
  Line,
  Rect,
  Ellipse,
  Text as KText,
  Group,
  Circle,
  Transformer,
} from "react-konva";
import type {
  Ann,
  ArrowAnn,
  CounterAnn,
  FxAnn,
  Settings,
  ShapeAnn,
  StrokeAnn,
  TextAnn,
  Tool,
} from "../../types";

let idCounter = 0;
const newId = () => `ann-${Date.now()}-${idCounter++}`;

export function contrastText(hex: string): string {
  const m = hex.replace("#", "");
  if (m.length < 6) return "#fff";
  const r = parseInt(m.slice(0, 2), 16);
  const g = parseInt(m.slice(2, 4), 16);
  const b = parseInt(m.slice(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6 ? "#000000" : "#FFFFFF";
}

/**
 * Annotations are stored in image pixel coordinates; the stage is scaled to
 * whatever fits on screen. Export therefore uses pixelRatio = 1/displayScale
 * to come back out at the image's native resolution.
 */
interface StageProps {
  imgW: number;
  imgH: number;
  displayScale: number;
  bgImage: CanvasImageSource | null;
  tool: Tool;
  color: string;
  strokeWidth: number;
  annCfg: Settings["annotations"];
  anns: Ann[];
  setAnnsLive: (a: Ann[]) => void;
  beginGesture: () => void;
  commit: (a: Ann[]) => void;
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
  editingTextId: string | null;
  onStartTextEdit: (id: string) => void;
  onEditCounter: (id: string) => void;
  stageRef: React.RefObject<Konva.Stage | null>;
  accent: string;
  /** Live crop rectangle in image coordinates while the crop tool is active. */
  crop: CropRect | null;
  onCropChange: (r: CropRect | null) => void;
}

export interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function AnnotationStage(props: StageProps) {
  const {
    imgW,
    imgH,
    displayScale,
    tool,
    color,
    strokeWidth,
    annCfg,
    anns,
    setAnnsLive,
    commit,
    setSelectedId,
    stageRef,
  } = props;

  const [draft, setDraft] = useState<Ann | null>(null);
  const drawing = useRef(false);

  const updateAnn = (id: string, patch: Partial<Ann>) => {
    setAnnsLive(anns.map((a) => (a.id === id ? ({ ...a, ...patch } as Ann) : a)));
  };

  /** Pointer position in image coordinates. */
  const pointer = (): { x: number; y: number } => {
    const p = stageRef.current?.getPointerPosition();
    if (!p) return { x: 0, y: 0 };
    return { x: p.x / displayScale, y: p.y / displayScale };
  };

  const handleMouseDown = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (e.evt.button !== 0) return;
    const { x, y } = pointer();

    // Crop is driven by the handles rendered over the stage, not by drawing
    // a fresh rectangle.
    if (tool === "crop") return;

    if (tool === "select") {
      const clickedEmpty = e.target === stageRef.current || e.target.name() === "bg";
      if (clickedEmpty) setSelectedId(null);
      return;
    }

    // Text is placed on click, not here: mounting the input during mousedown
    // means the matching mouseup lands on the canvas and immediately blurs it.
    if (tool === "text") return;

    if (tool === "counter") {
      const existing = anns.filter((a) => a.type === "counter") as CounterAnn[];
      const n =
        existing.length === 0
          ? annCfg.counterStart
          : Math.max(...existing.map((c) => c.n)) + 1;
      commit([
        ...anns,
        { id: newId(), type: "counter", x, y, n, color, size: annCfg.counterSize },
      ]);
      return;
    }

    drawing.current = true;
    setSelectedId(null);
    if (tool === "arrow" || tool === "line") {
      setDraft({ id: newId(), type: tool, points: [x, y, x, y], color, strokeWidth });
    } else if (tool === "rect" || tool === "ellipse") {
      setDraft({
        id: newId(),
        type: tool,
        x,
        y,
        w: 0,
        h: 0,
        color,
        strokeWidth,
        fill: "none",
      });
    } else if (tool === "pen" || tool === "highlighter") {
      setDraft({
        id: newId(),
        type: tool,
        points: [x, y],
        color,
        strokeWidth: tool === "highlighter" ? strokeWidth * 4 : strokeWidth,
        opacity: tool === "highlighter" ? annCfg.highlighterOpacity : 1,
      });
    } else if (tool === "blur" || tool === "pixelate") {
      setDraft({
        id: newId(),
        type: tool,
        x,
        y,
        w: 0,
        h: 0,
        strength: tool === "blur" ? annCfg.blurStrength : annCfg.pixelSize,
      });
    }
  };

  const handleMouseMove = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (!drawing.current || !draft) return;
    const { x, y } = pointer();
    // Shift constrains proportions: square / circle / 45° lines.
    const shift = e.evt.shiftKey;

    if (draft.type === "arrow" || draft.type === "line") {
      let ex = x;
      let ey = y;
      if (shift) {
        const dx = x - draft.points[0];
        const dy = y - draft.points[1];
        const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
        const len = Math.hypot(dx, dy);
        ex = draft.points[0] + Math.cos(angle) * len;
        ey = draft.points[1] + Math.sin(angle) * len;
      }
      setDraft({ ...draft, points: [draft.points[0], draft.points[1], ex, ey] });
    } else if (
      draft.type === "rect" ||
      draft.type === "ellipse" ||
      draft.type === "blur" ||
      draft.type === "pixelate"
    ) {
      let w = x - draft.x;
      let h = y - draft.y;
      if (shift) {
        const m = Math.max(Math.abs(w), Math.abs(h));
        w = Math.sign(w || 1) * m;
        h = Math.sign(h || 1) * m;
      }
      setDraft({ ...draft, w, h });
    } else if (draft.type === "pen" || draft.type === "highlighter") {
      if (shift) {
        const sx = draft.points[0];
        const sy = draft.points[1];
        const dx = x - sx;
        const dy = y - sy;
        const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
        const len = Math.hypot(dx, dy);
        setDraft({
          ...draft,
          points: [sx, sy, sx + Math.cos(angle) * len, sy + Math.sin(angle) * len],
        });
      } else {
        setDraft({ ...draft, points: [...draft.points, x, y] });
      }
    }
  };

  const handleMouseUp = () => {
    if (!drawing.current || !draft) {
      drawing.current = false;
      return;
    }
    drawing.current = false;
    let final = draft;
    let valid = true;
    if (
      final.type === "rect" ||
      final.type === "ellipse" ||
      final.type === "blur" ||
      final.type === "pixelate"
    ) {
      const f = final as ShapeAnn | FxAnn;
      const x = f.w < 0 ? f.x + f.w : f.x;
      const y = f.h < 0 ? f.y + f.h : f.y;
      const w = Math.abs(f.w);
      const h = Math.abs(f.h);
      valid = w >= 4 && h >= 4;
      final = { ...f, x, y, w, h } as Ann;
    } else if (final.type === "arrow" || final.type === "line") {
      const p = (final as ArrowAnn).points;
      valid = Math.hypot(p[2] - p[0], p[3] - p[1]) >= 5;
    } else if (final.type === "pen" || final.type === "highlighter") {
      valid = (final as StrokeAnn).points.length >= 4;
    }
    setDraft(null);
    if (valid) {
      commit([...anns, final]);
      setSelectedId(final.id);
    }
  };

  const handleClick = () => {
    if (tool !== "text") return;
    const { x, y } = pointer();
    const ann: TextAnn = {
      id: newId(),
      type: "text",
      x,
      y,
      text: "",
      color,
      fontSize: annCfg.fontSize,
    };
    commit([...anns, ann]);
    props.onStartTextEdit(ann.id);
  };

  const cursor = tool === "select" ? "default" : tool === "text" ? "text" : "crosshair";

  return (
    <Stage
      ref={stageRef as any}
      width={Math.round(imgW * displayScale)}
      height={Math.round(imgH * displayScale)}
      scaleX={displayScale}
      scaleY={displayScale}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onClick={handleClick}
      style={{ cursor, display: "block" }}
    >
      <Layer>
        {props.bgImage && (
          <KImage
            name="bg"
            image={props.bgImage as any}
            x={0}
            y={0}
            width={imgW}
            height={imgH}
            listening={tool === "select"}
          />
        )}
        {anns.map((ann) => (
          <AnnNode key={ann.id} ann={ann} props={props} updateAnn={updateAnn} />
        ))}
        {draft && <AnnNode ann={draft} props={props} updateAnn={() => {}} draft />}
        <SelectionChrome props={props} updateAnn={updateAnn} />
        {tool === "crop" && (
          <CropOverlay
            crop={props.crop}
            imgW={imgW}
            imgH={imgH}
            inv={1 / displayScale}
            accent={props.accent}
          />
        )}
      </Layer>
    </Stage>
  );
}

/** Dims everything outside the crop rectangle so the keep-area is obvious. */
function CropOverlay({
  crop,
  imgW,
  imgH,
  inv,
  accent,
}: {
  crop: CropRect | null;
  imgW: number;
  imgH: number;
  inv: number;
  accent: string;
}) {
  const shade = "rgba(0,0,0,0.45)";
  if (!crop || crop.w < 1 || crop.h < 1) {
    return <Rect x={0} y={0} width={imgW} height={imgH} fill={shade} listening={false} />;
  }
  return (
    <>
      <Rect x={0} y={0} width={imgW} height={crop.y} fill={shade} listening={false} />
      <Rect
        x={0}
        y={crop.y + crop.h}
        width={imgW}
        height={Math.max(0, imgH - crop.y - crop.h)}
        fill={shade}
        listening={false}
      />
      <Rect x={0} y={crop.y} width={crop.x} height={crop.h} fill={shade} listening={false} />
      <Rect
        x={crop.x + crop.w}
        y={crop.y}
        width={Math.max(0, imgW - crop.x - crop.w)}
        height={crop.h}
        fill={shade}
        listening={false}
      />
      <Rect
        x={crop.x}
        y={crop.y}
        width={crop.w}
        height={crop.h}
        stroke={accent}
        strokeWidth={1.5 * inv}
        listening={false}
      />
    </>
  );
}

// ---------------------------------------------------------------------------

function AnnNode({
  ann,
  props,
  updateAnn,
  draft,
}: {
  ann: Ann;
  props: StageProps;
  updateAnn: (id: string, patch: Partial<Ann>) => void;
  draft?: boolean;
}) {
  const { tool, beginGesture, setSelectedId } = props;
  const selectable = tool === "select" && !draft;
  const dragOrigin = useRef<{ x: number; y: number } | null>(null);

  const common = {
    id: ann.id,
    listening: selectable,
    draggable: selectable,
    onDragStart: (e: Konva.KonvaEventObject<DragEvent>) => {
      dragOrigin.current = { x: e.target.x(), y: e.target.y() };
      beginGesture();
    },
    // Shift while dragging locks movement to the dominant axis.
    onDragMove: (e: Konva.KonvaEventObject<DragEvent>) => {
      const o = dragOrigin.current;
      if (!o || !e.evt.shiftKey) return;
      const dx = e.target.x() - o.x;
      const dy = e.target.y() - o.y;
      if (Math.abs(dx) > Math.abs(dy)) e.target.y(o.y);
      else e.target.x(o.x);
    },
    onClick: () => selectable && setSelectedId(ann.id),
    onMouseEnter: (e: Konva.KonvaEventObject<MouseEvent>) => {
      if (selectable) {
        const stage = e.target.getStage();
        if (stage) stage.container().style.cursor = "move";
      }
    },
    onMouseLeave: (e: Konva.KonvaEventObject<MouseEvent>) => {
      const stage = e.target.getStage();
      if (stage) stage.container().style.cursor = "default";
    },
  };

  switch (ann.type) {
    case "arrow":
    case "line": {
      const a = ann as ArrowAnn;
      const Comp = ann.type === "arrow" ? Arrow : Line;
      return (
        <Comp
          {...common}
          points={a.points}
          stroke={a.color}
          fill={a.color}
          strokeWidth={a.strokeWidth}
          hitStrokeWidth={Math.max(12, a.strokeWidth)}
          lineCap="round"
          pointerLength={a.strokeWidth * 3.5}
          pointerWidth={a.strokeWidth * 3.5}
          onDragEnd={(e) => {
            const dx = e.target.x();
            const dy = e.target.y();
            e.target.position({ x: 0, y: 0 });
            updateAnn(a.id, {
              points: [
                a.points[0] + dx,
                a.points[1] + dy,
                a.points[2] + dx,
                a.points[3] + dy,
              ],
            } as Partial<ArrowAnn>);
          }}
        />
      );
    }
    case "rect": {
      const a = ann as ShapeAnn;
      return (
        <Rect
          {...common}
          x={a.x}
          y={a.y}
          width={a.w}
          height={a.h}
          stroke={a.color}
          strokeWidth={a.strokeWidth}
          cornerRadius={2}
          fill={a.fill === "solid" ? a.color : a.fill === "translucent" ? `${a.color}40` : undefined}
          fillEnabled={a.fill !== "none"}
          hitStrokeWidth={12}
          onDragEnd={(e) => updateAnn(a.id, { x: e.target.x(), y: e.target.y() })}
          onTransformStart={() => beginGesture()}
          onTransformEnd={(e) => bakeRectTransform(e, a, updateAnn)}
        />
      );
    }
    case "ellipse": {
      const a = ann as ShapeAnn;
      return (
        <Ellipse
          {...common}
          x={a.x + a.w / 2}
          y={a.y + a.h / 2}
          radiusX={Math.abs(a.w / 2)}
          radiusY={Math.abs(a.h / 2)}
          stroke={a.color}
          strokeWidth={a.strokeWidth}
          fill={a.fill === "solid" ? a.color : a.fill === "translucent" ? `${a.color}40` : undefined}
          fillEnabled={a.fill !== "none"}
          hitStrokeWidth={12}
          onDragEnd={(e) =>
            updateAnn(a.id, { x: e.target.x() - a.w / 2, y: e.target.y() - a.h / 2 })
          }
          onTransformStart={() => beginGesture()}
          onTransformEnd={(e) => {
            const node = e.target;
            const sx = node.scaleX();
            const sy = node.scaleY();
            node.scale({ x: 1, y: 1 });
            const w = Math.max(6, a.w * sx);
            const h = Math.max(6, a.h * sy);
            updateAnn(a.id, { x: node.x() - w / 2, y: node.y() - h / 2, w, h });
          }}
        />
      );
    }
    case "pen":
    case "highlighter": {
      const a = ann as StrokeAnn;
      return (
        <Line
          {...common}
          points={a.points}
          stroke={a.color}
          strokeWidth={a.strokeWidth}
          opacity={a.opacity}
          lineCap="round"
          lineJoin="round"
          hitStrokeWidth={Math.max(14, a.strokeWidth)}
          tension={props.annCfg.penSmoothing && a.type === "pen" ? 0.4 : 0}
          onDragEnd={(e) => {
            const dx = e.target.x();
            const dy = e.target.y();
            e.target.position({ x: 0, y: 0 });
            updateAnn(a.id, {
              points: a.points.map((v, i) => (i % 2 === 0 ? v + dx : v + dy)),
            } as Partial<StrokeAnn>);
          }}
        />
      );
    }
    case "text": {
      const a = ann as TextAnn;
      return (
        <KText
          {...common}
          x={a.x}
          y={a.y}
          text={a.text}
          fontSize={a.fontSize}
          fontFamily='"Inter", "Segoe UI", system-ui, sans-serif'
          fontStyle="600"
          fill={a.color}
          shadowColor="rgba(0,0,0,0.45)"
          shadowBlur={3}
          shadowOffsetY={1}
          visible={props.editingTextId !== a.id}
          onDragEnd={(e) => updateAnn(a.id, { x: e.target.x(), y: e.target.y() })}
          onDblClick={() => props.onStartTextEdit(a.id)}
          onTransformStart={() => beginGesture()}
          onTransformEnd={(e) => {
            const node = e.target;
            const s = node.scaleY();
            node.scale({ x: 1, y: 1 });
            updateAnn(a.id, {
              x: node.x(),
              y: node.y(),
              fontSize: Math.max(8, a.fontSize * s),
            });
          }}
        />
      );
    }
    case "counter": {
      const a = ann as CounterAnn;
      const r = a.size / 2;
      return (
        <Group
          {...common}
          x={a.x}
          y={a.y}
          onDragEnd={(e) => updateAnn(a.id, { x: e.target.x(), y: e.target.y() })}
          onDblClick={() => props.onEditCounter(a.id)}
          onTransformStart={() => beginGesture()}
          onTransformEnd={(e) => {
            const node = e.target;
            const s = node.scaleX();
            node.scale({ x: 1, y: 1 });
            updateAnn(a.id, { x: node.x(), y: node.y(), size: Math.max(14, a.size * s) });
          }}
        >
          <Circle
            radius={r}
            fill={a.color}
            stroke="rgba(255,255,255,0.9)"
            strokeWidth={1.5}
            shadowColor="rgba(0,0,0,0.35)"
            shadowBlur={4}
            shadowOffsetY={1}
          />
          <KText
            text={String(a.n)}
            fontSize={r * (String(a.n).length > 1 ? 0.9 : 1.1)}
            fontStyle="bold"
            fontFamily='"Inter", "Segoe UI", system-ui, sans-serif'
            fill={contrastText(a.color)}
            width={a.size}
            height={a.size}
            offsetX={r}
            offsetY={r}
            align="center"
            verticalAlign="middle"
          />
        </Group>
      );
    }
    case "blur":
    case "pixelate":
      return <FxNode ann={ann as FxAnn} props={props} updateAnn={updateAnn} common={common} />;
    default:
      return null;
  }
}

function bakeRectTransform(
  e: Konva.KonvaEventObject<Event>,
  a: ShapeAnn | FxAnn,
  updateAnn: (id: string, patch: Partial<Ann>) => void,
) {
  const node = e.target;
  const sx = node.scaleX();
  const sy = node.scaleY();
  node.scale({ x: 1, y: 1 });
  updateAnn(a.id, {
    x: node.x(),
    y: node.y(),
    w: Math.max(6, a.w * sx),
    h: Math.max(6, a.h * sy),
  });
}

/**
 * Blur / pixelate: a filtered copy of the source image, permanently rendered
 * into the export. The source crop reaches `m` px past the visible rect and
 * the group clips it back, so the filter's soft transparent edge falls
 * outside the clip and no pale halo shows at the border.
 */
function FxNode({
  ann,
  props,
  updateAnn,
  common,
}: {
  ann: FxAnn;
  props: StageProps;
  updateAnn: (id: string, patch: Partial<Ann>) => void;
  common: any;
}) {
  const ref = useRef<Konva.Image>(null);
  const { bgImage, imgW, imgH } = props;

  const w = Math.abs(ann.w);
  const h = Math.abs(ann.h);
  const x = ann.w < 0 ? ann.x + ann.w : ann.x;
  const y = ann.h < 0 ? ann.y + ann.h : ann.y;
  const m = Math.max(12, ann.strength);

  const cx0 = Math.max(0, x - m);
  const cy0 = Math.max(0, y - m);
  const cx1 = Math.min(imgW, x + w + m);
  const cy1 = Math.min(imgH, y + h + m);

  useEffect(() => {
    const node = ref.current;
    if (!node || !bgImage || w < 2 || h < 2) return;
    node.cache();
    node.getLayer()?.batchDraw();
  }, [bgImage, x, y, w, h, ann.strength]);

  if (!bgImage || w < 2 || h < 2 || cx1 <= cx0 || cy1 <= cy0) return null;

  return (
    <Group
      {...common}
      x={x}
      y={y}
      clipX={0}
      clipY={0}
      clipWidth={w}
      clipHeight={h}
      onDragEnd={(e: Konva.KonvaEventObject<DragEvent>) =>
        updateAnn(ann.id, { x: e.target.x(), y: e.target.y(), w, h })
      }
      onTransformStart={() => props.beginGesture()}
      onTransformEnd={(e: Konva.KonvaEventObject<Event>) =>
        bakeRectTransform(e, { ...ann, x, y, w, h }, updateAnn)
      }
    >
      <KImage
        ref={ref}
        image={bgImage as any}
        x={cx0 - x}
        y={cy0 - y}
        width={cx1 - cx0}
        height={cy1 - cy0}
        crop={{ x: cx0, y: cy0, width: cx1 - cx0, height: cy1 - cy0 }}
        filters={[ann.type === "blur" ? Konva.Filters.Blur : Konva.Filters.Pixelate]}
        blurRadius={ann.type === "blur" ? ann.strength : 0}
        pixelSize={ann.type === "pixelate" ? Math.max(2, ann.strength) : 1}
      />
    </Group>
  );
}

// ---------------------------------------------------------------------------

function SelectionChrome({
  props,
  updateAnn,
}: {
  props: StageProps;
  updateAnn: (id: string, patch: Partial<Ann>) => void;
}) {
  const { anns, selectedId, stageRef, tool, beginGesture, displayScale, accent } = props;
  const trRef = useRef<Konva.Transformer>(null);
  const selAnn = anns.find((a) => a.id === selectedId) ?? null;

  // Shift while resizing keeps the aspect ratio for any shape.
  const [shiftDown, setShiftDown] = useState(false);
  useEffect(() => {
    const down = (e: KeyboardEvent) => e.key === "Shift" && setShiftDown(true);
    const up = (e: KeyboardEvent) => e.key === "Shift" && setShiftDown(false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  const transformable =
    selAnn && ["rect", "ellipse", "text", "counter", "blur", "pixelate"].includes(selAnn.type);

  useEffect(() => {
    const tr = trRef.current;
    const stage = stageRef.current;
    if (!tr || !stage) return;
    if (transformable && selectedId && tool === "select") {
      const node = stage.findOne(`#${selectedId}`);
      if (node) {
        tr.nodes([node]);
        tr.getLayer()?.batchDraw();
        return;
      }
    }
    tr.nodes([]);
    tr.getLayer()?.batchDraw();
  }, [selectedId, transformable, tool, anns, stageRef]);

  const isLine = selAnn && (selAnn.type === "arrow" || selAnn.type === "line");
  // Chrome is drawn inside the scaled stage, so counter-scale it to keep
  // handles a constant on-screen size regardless of zoom.
  const inv = 1 / displayScale;

  return (
    <>
      <Transformer
        ref={trRef}
        rotateEnabled={false}
        flipEnabled={false}
        keepRatio={selAnn?.type === "counter" || selAnn?.type === "text" || shiftDown}
        enabledAnchors={
          selAnn?.type === "text" || selAnn?.type === "counter"
            ? ["top-left", "top-right", "bottom-left", "bottom-right"]
            : undefined
        }
        anchorSize={8 * inv}
        anchorCornerRadius={4 * inv}
        anchorStrokeWidth={1.5 * inv}
        borderStrokeWidth={1 * inv}
        anchorStroke={accent}
        borderStroke={accent}
        borderDash={[4 * inv, 3 * inv]}
        boundBoxFunc={(oldBox, newBox) =>
          Math.abs(newBox.width) < 6 || Math.abs(newBox.height) < 6 ? oldBox : newBox
        }
      />
      {isLine &&
        tool === "select" &&
        ([0, 1] as const).map((end) => {
          const a = selAnn as ArrowAnn;
          return (
            <Circle
              key={end}
              x={a.points[end * 2]}
              y={a.points[end * 2 + 1]}
              radius={5.5 * inv}
              fill="#fff"
              stroke={accent}
              strokeWidth={1.5 * inv}
              draggable
              onDragStart={() => beginGesture()}
              onDragMove={(e) => {
                const p: [number, number, number, number] = [...a.points];
                p[end * 2] = e.target.x();
                p[end * 2 + 1] = e.target.y();
                updateAnn(a.id, { points: p } as Partial<ArrowAnn>);
              }}
            />
          );
        })}
    </>
  );
}
