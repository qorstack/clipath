import Konva from "konva";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { FolderOpen, Settings as SettingsIcon } from "lucide-react";
import { ipc } from "../../lib/ipc";
import type { Ann, CounterAnn, FinalAction, RecentItem, Settings, TextAnn, Tool } from "../../types";
import { AnnotationStage } from "../capture/AnnotationStage";
import { ActionBar, Toolbar } from "../capture/Toolbar";

const TOOL_KEYS: Record<string, Tool> = {
  v: "select",
  c: "crop",
  a: "arrow",
  l: "line",
  r: "rect",
  o: "ellipse",
  p: "pen",
  h: "highlighter",
  t: "text",
  b: "blur",
  x: "pixelate",
  n: "counter",
};

const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

export function Editor({
  path: requestedPath,
  settings,
  onOpenSettings,
}: {
  path: string;
  settings: Settings;
  onOpenSettings: () => void;
}) {
  // The editor owns which file it is showing. A capture taken while the editor
  // is open swaps the image in place instead of opening another window.
  const [path, setPath] = useState(requestedPath);
  const [reloadKey, setReloadKey] = useState(0);
  const [crop, setCrop] = useState<{ x: number; y: number; w: number; h: number } | null>(
    null,
  );
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef(0);
  const [recent, setRecent] = useState<RecentItem[]>([]);
  const [viewport, setViewport] = useState({ w: 800, h: 500 });

  const [tool, setToolRaw] = useState<Tool>(settings.annotations.defaultTool);
  const [color, setColorRaw] = useState(settings.annotations.defaultColor);
  const [recentColors, setRecentColors] = useState<string[]>([]);
  const [strokeWidth, setStrokeWidth] = useState(settings.annotations.strokeWidth);

  const [anns, setAnns] = useState<Ann[]>([]);
  const annsRef = useRef<Ann[]>([]);
  annsRef.current = anns;
  const past = useRef<Ann[][]>([]);
  const future = useRef<Ann[][]>([]);
  const [, setHistoryTick] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  selectedIdRef.current = selectedId;
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  const [editingCounterId, setEditingCounterId] = useState<string | null>(null);

  const stageRef = useRef<Konva.Stage | null>(null);
  const canvasAreaRef = useRef<HTMLDivElement>(null);
  const objectUrl = useRef<string | null>(null);

  const filename = path.split(/[\\/]/).pop() ?? path;
  const folder = path.slice(0, Math.max(0, path.length - filename.length - 1));

  // ---- load the image ------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    setImage(null);
    setAnns([]);
    past.current = [];
    future.current = [];
    setSelectedId(null);
    setEditingTextId(null);
    setError(null);

    (async () => {
      try {
        const buf = await ipc.readImage(path);
        if (cancelled) return;
        const ext = path.split(".").pop()?.toLowerCase() ?? "png";
        const blob = new Blob([buf], { type: MIME[ext] ?? "image/png" });
        // A blob: URL keeps the annotation canvas same-origin, so the export
        // is not blocked by canvas tainting.
        if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
        objectUrl.current = URL.createObjectURL(blob);
        const img = new Image();
        img.src = objectUrl.current;
        img.onload = () => !cancelled && setImage(img);
        img.onerror = () => !cancelled && setError("Could not open this image");
      } catch (e) {
        if (!cancelled) setError(String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [path, reloadKey]);

  useEffect(
    () => () => {
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    },
    [],
  );

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 1800);
  }, []);
  useEffect(() => () => window.clearTimeout(toastTimer.current), []);

  // ---- recent strip --------------------------------------------------------
  const refreshRecent = useCallback(() => {
    ipc
      .listRecent(Math.max(12, settings.recent.limit))
      .then(setRecent)
      .catch(console.error);
  }, [settings.recent.limit]);
  useEffect(refreshRecent, [refreshRecent, path]);

  // ---- fit the image to the available area --------------------------------
  useEffect(() => {
    const measure = () => {
      const el = canvasAreaRef.current;
      if (el) setViewport({ w: el.clientWidth, h: el.clientHeight });
    };
    measure();
    window.addEventListener("resize", measure);
    const ro = new ResizeObserver(measure);
    if (canvasAreaRef.current) ro.observe(canvasAreaRef.current);
    return () => {
      window.removeEventListener("resize", measure);
      ro.disconnect();
    };
  }, []);

  const displayScale = useMemo(() => {
    if (!image) return 1;
    const fit = Math.min(
      (viewport.w - 24) / image.naturalWidth,
      (viewport.h - 24) / image.naturalHeight,
    );
    // Never upscale — a small capture stays crisp at 1:1.
    return Math.max(0.05, Math.min(1, fit));
  }, [image, viewport]);

  // ---- history -------------------------------------------------------------
  const beginGesture = useCallback(() => {
    past.current.push(annsRef.current);
    future.current = [];
    setHistoryTick((t) => t + 1);
  }, []);
  const commit = useCallback((next: Ann[]) => {
    past.current.push(annsRef.current);
    future.current = [];
    setAnns(next);
    setHistoryTick((t) => t + 1);
  }, []);
  const undo = useCallback(() => {
    const prev = past.current.pop();
    if (prev === undefined) return;
    future.current.push(annsRef.current);
    setAnns(prev);
    setSelectedId(null);
    setHistoryTick((t) => t + 1);
  }, []);
  const redo = useCallback(() => {
    const next = future.current.pop();
    if (next === undefined) return;
    past.current.push(annsRef.current);
    setAnns(next);
    setHistoryTick((t) => t + 1);
  }, []);

  const setColor = useCallback(
    (c: string) => {
      setColorRaw(c);
      setRecentColors((r) => [c, ...r.filter((x) => x !== c)].slice(0, 8));
      const sel = annsRef.current.find((a) => a.id === selectedIdRef.current);
      if (sel && "color" in sel) {
        commit(
          annsRef.current.map((a) => (a.id === sel.id ? { ...a, color: c } : a)) as Ann[],
        );
      }
    },
    [commit],
  );

  const setTool = useCallback((t: Tool) => {
    setToolRaw(t);
    if (t !== "select") setSelectedId(null);
    if (t !== "crop") setCrop(null);
  }, []);

  // ---- export --------------------------------------------------------------
  const exportDataUrl = useCallback(async (): Promise<string> => {
    setSelectedId(null);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const stage = stageRef.current;
    if (!stage) throw new Error("editor not ready");
    // Render back out at the image's native resolution.
    return stage.toDataURL({ pixelRatio: 1 / displayScale, mimeType: "image/png" });
  }, [displayScale]);

  const rememberPrefs = useCallback(async () => {
    const cfg = settings.annotations;
    if (!cfg.rememberLastTool && !cfg.rememberLastColor) return;
    try {
      const s = await ipc.getSettings();
      if (cfg.rememberLastTool && tool !== "select") s.annotations.defaultTool = tool;
      if (cfg.rememberLastColor) s.annotations.defaultColor = color;
      await ipc.setSettings(s);
    } catch {
      /* non-critical */
    }
  }, [settings, tool, color]);

  const finalize = useCallback(
    async (action: FinalAction) => {
      if (busy || !image) return;
      setBusy(true);
      try {
        const dataUrl = await exportDataUrl();
        await rememberPrefs();
        await ipc.finalizeImage(path, action, dataUrl);
        // Copying leaves the editor open so another path can be grabbed from
        // Recent; only Save & Close puts the window away.
        if (action === "save") {
          await ipc.closeEditor();
        } else {
          refreshRecent();
          showToast(
            action === "copy-path"
              ? "Path copied"
              : action === "copy-image"
                ? "Image copied"
                : "Pinned to screen",
          );
        }
      } catch (e) {
        setError(String(e));
      } finally {
        setBusy(false);
      }
    },
    [busy, image, exportDataUrl, rememberPrefs, path, refreshRecent, showToast],
  );

  /** Flatten pending annotations into the file without closing the editor. */
  const applyPending = useCallback(async () => {
    if (annsRef.current.length === 0) return;
    try {
      const dataUrl = await exportDataUrl();
      await ipc.finalizeImage(path, "save", dataUrl);
    } catch (e) {
      console.error(e);
    }
  }, [exportDataUrl, path]);

  /** Switch to another file, keeping any work already done on this one. */
  const openPath = useCallback(
    async (next: string) => {
      if (next === path) return;
      await applyPending();
      setCrop(null);
      setPath(next);
    },
    [path, applyPending],
  );

  // A newly requested capture arrives while the editor is open.
  useEffect(() => {
    if (requestedPath !== path) openPath(requestedPath);
    // openPath is intentionally not a dependency: it changes on every path
    // update and would re-fire this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedPath]);

  const applyCrop = useCallback(async () => {
    if (!crop || !image || crop.w < 8 || crop.h < 8 || busy) return;
    setBusy(true);
    try {
      setSelectedId(null);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const stage = stageRef.current;
      if (!stage) throw new Error("editor not ready");
      // Crop coordinates are image-space; the stage is scaled, so convert to
      // stage space and render back out at native resolution.
      const dataUrl = stage.toDataURL({
        x: crop.x * displayScale,
        y: crop.y * displayScale,
        width: crop.w * displayScale,
        height: crop.h * displayScale,
        pixelRatio: 1 / displayScale,
        mimeType: "image/png",
      });
      await ipc.finalizeImage(path, "save", dataUrl);
      setCrop(null);
      setToolRaw("select");
      setReloadKey((k) => k + 1);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }, [crop, image, busy, displayScale, path]);

  const handleMore = useCallback(
    async (id: string) => {
      try {
        switch (id) {
          case "save-as": {
            const target = await saveDialog({
              defaultPath: filename,
              filters: [{ name: "Images", extensions: ["png", "jpg", "webp"] }],
            });
            if (!target) return;
            await ipc.saveImageAs(target, await exportDataUrl());
            break;
          }
          case "open-folder":
            await applyPending();
            await ipc.revealInFolder(path);
            break;
          case "copy-filename":
            await ipc.copyText(filename);
            break;
          case "copy-folder":
            await ipc.copyText(folder);
            break;
          case "delete":
            await ipc.deleteFile(path);
            await ipc.closeEditor();
            break;
        }
      } catch (e) {
        setError(String(e));
      }
    },
    [filename, folder, path, exportDataUrl, applyPending],
  );

  // ---- keyboard ------------------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (editingTextId || editingCounterId) return;
      const target = e.target as HTMLElement;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      const key = e.key.toLowerCase();

      if (e.key === "Escape") {
        e.preventDefault();
        if (selectedId) setSelectedId(null);
        else ipc.closeEditor();
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        finalize(settings.output.defaultFinalAction);
        return;
      }
      if (e.ctrlKey && key === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (e.ctrlKey && key === "y") {
        e.preventDefault();
        redo();
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && selectedId) {
        e.preventDefault();
        commit(annsRef.current.filter((a) => a.id !== selectedId));
        setSelectedId(null);
        return;
      }
      if (e.key.startsWith("Arrow") && selectedId) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
        beginGesture();
        setAnns(
          annsRef.current.map((a) => {
            if (a.id !== selectedId) return a;
            if ("points" in a)
              return {
                ...a,
                points: a.points.map((v, i) => (i % 2 === 0 ? v + dx : v + dy)),
              } as Ann;
            if ("x" in a) return { ...a, x: a.x + dx, y: a.y + dy } as Ann;
            return a;
          }),
        );
        return;
      }
      if (!e.ctrlKey && !e.altKey && !e.metaKey && TOOL_KEYS[key]) setTool(TOOL_KEYS[key]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    editingTextId,
    editingCounterId,
    selectedId,
    finalize,
    settings,
    undo,
    redo,
    commit,
    beginGesture,
    setTool,
  ]);

  const editingText = editingTextId
    ? (anns.find((a) => a.id === editingTextId) as TextAnn | undefined)
    : undefined;
  const editingCounter = editingCounterId
    ? (anns.find((a) => a.id === editingCounterId) as CounterAnn | undefined)
    : undefined;

  const stageW = image ? Math.round(image.naturalWidth * displayScale) : 0;
  const stageH = image ? Math.round(image.naturalHeight * displayScale) : 0;

  return (
    <div className="relative flex h-full flex-col" style={{ background: "var(--bg)" }}>
      {/* header */}
      <header
        data-tauri-drag-region
        className="flex shrink-0 items-center gap-3 border-b px-4 py-2.5"
        style={{ borderColor: "var(--border)" }}
      >
        <div className="min-w-0 flex-1" data-tauri-drag-region>
          <div className="truncate text-[13px] font-semibold">{filename}</div>
          <div className="truncate text-[11.5px]" style={{ color: "var(--text-2)" }}>
            {image ? `${image.naturalWidth} × ${image.naturalHeight}` : "Loading…"} · {folder}
          </div>
        </div>
        <HeaderButton title="Open folder" onClick={() => ipc.revealInFolder(path)}>
          <FolderOpen size={15} />
        </HeaderButton>
        <HeaderButton title="Settings" onClick={onOpenSettings}>
          <SettingsIcon size={15} />
        </HeaderButton>
      </header>

      {/* toolbar */}
      <div className="flex shrink-0 justify-center px-4 pt-3">
        <Toolbar
          tool={tool}
          setTool={setTool}
          color={color}
          setColor={setColor}
          recentColors={recentColors}
          strokeWidth={strokeWidth}
          setStrokeWidth={setStrokeWidth}
          canUndo={past.current.length > 0}
          canRedo={future.current.length > 0}
          undo={undo}
          redo={redo}
          showTooltips={settings.annotations.showTooltips}
        />
      </div>

      {/* canvas */}
      <div
        ref={canvasAreaRef}
        className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden p-3"
      >
        {error && (
          <div
            className="panel-shadow max-w-[420px] rounded-[12px] border p-4"
            style={{ background: "var(--panel)", borderColor: "var(--border)" }}
          >
            <div className="text-[13px] font-semibold">Something went wrong</div>
            <div className="mt-1 text-[12px]" style={{ color: "var(--text-2)" }}>
              {error}
            </div>
          </div>
        )}
        {!error && image && (
          <div className="relative" style={{ width: stageW, height: stageH }}>
            <AnnotationStage
              imgW={image.naturalWidth}
              imgH={image.naturalHeight}
              displayScale={displayScale}
              bgImage={image}
              tool={tool}
              color={color}
              strokeWidth={strokeWidth}
              annCfg={settings.annotations}
              anns={anns}
              setAnnsLive={setAnns}
              beginGesture={beginGesture}
              commit={commit}
              selectedId={selectedId}
              setSelectedId={setSelectedId}
              editingTextId={editingTextId}
              onStartTextEdit={(id) => {
                setEditingTextId(id);
                setSelectedId(null);
              }}
              onEditCounter={setEditingCounterId}
              stageRef={stageRef}
              accent={settings.appearance.accent}
              crop={crop}
              onCropChange={setCrop}
            />

            {tool === "crop" && (
              <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
                <div
                  className="panel-shadow pointer-events-auto flex items-center gap-2 rounded-[11px] border px-2.5 py-1.5"
                  style={{
                    background: "var(--elevated)",
                    borderColor: "var(--border)",
                    backdropFilter: "blur(20px)",
                  }}
                >
                  <span className="text-[12px]" style={{ color: "var(--text-2)" }}>
                    {crop && crop.w >= 8
                      ? `${Math.round(crop.w)} × ${Math.round(crop.h)}`
                      : "Drag to choose the area to keep"}
                  </span>
                  <button
                    onClick={() => {
                      setCrop(null);
                      setToolRaw("select");
                    }}
                    className="rounded-[7px] px-2.5 py-1 text-[12px] font-medium"
                    style={{ background: "var(--control)", color: "var(--text)" }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={applyCrop}
                    disabled={!crop || crop.w < 8 || crop.h < 8 || busy}
                    className="rounded-[7px] px-3 py-1 text-[12px] font-semibold text-white disabled:opacity-40"
                    style={{ background: "var(--accent)" }}
                  >
                    Apply Crop
                  </button>
                </div>
              </div>
            )}

            {editingText && (
              <TextEditor
                ann={editingText}
                scale={displayScale}
                onChange={(text) =>
                  setAnns(
                    annsRef.current.map((a) =>
                      a.id === editingText.id ? { ...a, text } : a,
                    ) as Ann[],
                  )
                }
                onDone={(empty) => {
                  if (empty)
                    setAnns(annsRef.current.filter((a) => a.id !== editingText.id));
                  setEditingTextId(null);
                  setToolRaw("select");
                }}
              />
            )}

            {editingCounter && (
              <input
                autoFocus
                type="number"
                defaultValue={editingCounter.n}
                className="absolute z-50 w-[64px] rounded-[8px] border px-2 py-1 text-center text-[13px] font-semibold"
                style={{
                  left: editingCounter.x * displayScale - 32,
                  top:
                    (editingCounter.y + editingCounter.size / 2) * displayScale + 6,
                  background: "var(--elevated)",
                  borderColor: "var(--border)",
                  color: "var(--text)",
                }}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === "Enter") {
                    const n = Number((e.target as HTMLInputElement).value);
                    if (Number.isFinite(n))
                      commit(
                        annsRef.current.map((a) =>
                          a.id === editingCounter.id ? { ...a, n: Math.round(n) } : a,
                        ) as Ann[],
                      );
                    setEditingCounterId(null);
                  }
                  if (e.key === "Escape") setEditingCounterId(null);
                }}
                onBlur={() => setEditingCounterId(null)}
              />
            )}
          </div>
        )}
      </div>

      {/* recent strip */}
      {recent.length > 1 && (
        <div className="shrink-0 px-4">
          <div
            className="flex items-center gap-2 overflow-x-auto rounded-[12px] border p-2"
            style={{ background: "var(--panel)", borderColor: "var(--border)" }}
          >
            <span
              className="shrink-0 px-1 text-[11px] font-semibold uppercase tracking-wide"
              style={{ color: "var(--text-2)" }}
            >
              Recent
            </span>
            {recent.map((item) => {
              const active = item.path === path;
              return (
                <button
                  key={item.path}
                  title={item.filename}
                  disabled={busy}
                  onClick={() => openPath(item.path)}
                  className="h-[56px] w-[78px] shrink-0 overflow-hidden rounded-[7px] border transition-transform hover:scale-105 disabled:opacity-50"
                  style={{
                    borderColor: active ? "var(--accent)" : "var(--border)",
                    boxShadow: active ? "0 0 0 2px var(--accent)" : "none",
                    background: "var(--control)",
                  }}
                >
                  <img
                    // Display-only, so the asset protocol is fine here — this
                    // never touches the export canvas.
                    src={convertFileSrc(item.path)}
                    alt={item.filename}
                    loading="lazy"
                    draggable={false}
                    className="h-full w-full object-cover"
                  />
                </button>
              );
            })}
          </div>
        </div>
      )}

      {toast && (
        <div
          className="panel-shadow pointer-events-none absolute left-1/2 top-16 z-50 -translate-x-1/2 rounded-full px-4 py-1.5 text-[12.5px] font-medium"
          style={{ background: "var(--elevated)", color: "var(--text)" }}
        >
          {toast}
        </div>
      )}

      {/* actions */}
      <div className="flex shrink-0 justify-center px-4 py-3">
        <ActionBar
          onAction={finalize}
          onMore={handleMore}
          moreOpen={false}
          showTooltips={settings.annotations.showTooltips}
          busy={busy || !image}
        />
      </div>
    </div>
  );
}

function HeaderButton({
  children,
  onClick,
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
}) {
  return (
    <button
      title={title}
      aria-label={title}
      onClick={onClick}
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] transition-colors"
      style={{ color: "var(--text-2)" }}
      onMouseEnter={(e) =>
        ((e.currentTarget as HTMLElement).style.background = "var(--control-hover)")
      }
      onMouseLeave={(e) =>
        ((e.currentTarget as HTMLElement).style.background = "transparent")
      }
    >
      {children}
    </button>
  );
}

function TextEditor({
  ann,
  scale,
  onChange,
  onDone,
}: {
  ann: TextAnn;
  scale: number;
  onChange: (text: string) => void;
  onDone: (empty: boolean) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <textarea
      ref={ref}
      defaultValue={ann.text}
      spellCheck={false}
      className="absolute z-50 resize-none overflow-hidden bg-transparent outline-none"
      style={{
        left: ann.x * scale - 2,
        top: ann.y * scale - 2,
        minWidth: 160,
        minHeight: ann.fontSize * scale * 1.5,
        fontSize: ann.fontSize * scale,
        fontWeight: 600,
        lineHeight: 1.25,
        fontFamily: '"Inter", "Segoe UI", system-ui, sans-serif',
        color: ann.color,
        caretColor: ann.color,
        textShadow: "0 1px 3px rgba(0,0,0,0.45)",
        border: "1px dashed rgba(128,128,128,0.6)",
        padding: 1,
      }}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape" || (e.key === "Enter" && e.ctrlKey))
          onDone(!(e.target as HTMLTextAreaElement).value.trim());
      }}
      onBlur={(e) => onDone(!e.target.value.trim())}
    />
  );
}
