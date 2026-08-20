import Konva from "konva";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { FolderOpen, Settings as SettingsIcon } from "lucide-react";
import { ipc } from "../../lib/ipc";
import { exportPixelRatio } from "../../lib/exportScale";
import type { Ann, CounterAnn, FinalAction, RecentItem, Settings, TextAnn, Tool } from "../../types";
import { AnnotationStage, type CropRect } from "../capture/AnnotationStage";
import { ActionBar, Toolbar } from "../capture/Toolbar";
import { CropBox, RATIOS, fitRatio } from "./CropBox";
import { TOOL_KEYS } from "./keymap";

const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

/**
 * Resolves after the next two frames — or after 150ms if frames never come.
 * Frame callbacks stop entirely in a window Chromium believes is hidden, and
 * the editor is exactly that until editorReady puts it on screen, so waiting
 * on them alone deadlocked every cold open into the backend's slow fallback.
 */
const nextPaint = () =>
  new Promise<void>((resolve) => {
    let done = false;
    const go = () => {
      if (!done) {
        done = true;
        resolve();
      }
    };
    requestAnimationFrame(() => requestAnimationFrame(go));
    window.setTimeout(go, 150);
  });

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
  const [crop, setCrop] = useState<CropRect | null>(null);
  const [ratioId, setRatioId] = useState("free");
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
  const activeThumb = useRef<HTMLButtonElement>(null);

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
        img.onload = () => {
          if (cancelled) return;
          setImage(img);
          // The window is held back until there is something in it. Two frames
          // give the paint time to reach the compositor — but only when frames
          // are being serviced at all, hence the timeout inside nextPaint.
          nextPaint().then(() => ipc.editorReady().catch(() => {}));
        };
        img.onerror = () => {
          if (cancelled) return;
          setError("Could not open this image");
          // Still show the window: an error the user can read beats nothing.
          ipc.editorReady().catch(() => {});
        };
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

  // Keep the open capture in view when stepping through Recent with the
  // arrow keys — 'nearest' scrolls only when it has actually gone off-screen.
  useEffect(() => {
    activeThumb.current?.scrollIntoView({
      block: "nearest",
      inline: "nearest",
      behavior: "smooth",
    });
  }, [path, recent]);

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

  // Crop opens on the whole image so the edges can be pushed inward.
  useEffect(() => {
    if (tool !== "crop" || !image) return;
    setCrop((c) => c ?? { x: 0, y: 0, w: image.naturalWidth, h: image.naturalHeight });
  }, [tool, image]);

  const applyRatio = useCallback(
    (id: string) => {
      setRatioId(id);
      if (!image) return;
      const preset = RATIOS.find((r) => r.id === id);
      if (!preset || preset.value === null) return;
      const value =
        preset.id === "original" ? image.naturalWidth / image.naturalHeight : preset.value;
      setCrop(fitRatio(image.naturalWidth, image.naturalHeight, value));
    },
    [image],
  );

  const ratio = useMemo(() => {
    const preset = RATIOS.find((r) => r.id === ratioId);
    if (!preset || preset.value === null || !image) return null;
    return preset.id === "original"
      ? image.naturalWidth / image.naturalHeight
      : preset.value;
  }, [ratioId, image]);

  // ---- export --------------------------------------------------------------
  const exportDataUrl = useCallback(async (): Promise<string> => {
    setSelectedId(null);
    await nextPaint();
    const stage = stageRef.current;
    if (!stage) throw new Error("editor not ready");
    // Without the image the stage renders an empty canvas, and exporting that
    // writes a blank file straight over the capture it came from. Better to
    // refuse than to destroy the screenshot.
    if (!image) throw new Error("image is still loading");
    // Back out at the image's native resolution. The ratio comes from the
    // stage's actual width rather than from displayScale: the stage size is a
    // rounded number of pixels, so scaling by 1/displayScale landed a pixel
    // short and every save shaved a column off the capture.
    const pixelRatio = exportPixelRatio(image.naturalWidth, stage.width());
    const url = stage.toDataURL({ pixelRatio, mimeType: "image/png" });
    if (!url || url.length < 128) throw new Error("could not render the image");
    return url;
  }, [image]);

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
        // Nothing drawn means nothing to re-render. Rewriting the file anyway
        // re-encoded it for no reason — losing a column to rounding, and for
        // JPEG losing quality — just because the path was copied.
        const dataUrl = annsRef.current.length > 0 ? await exportDataUrl() : "";
        await rememberPrefs();
        await ipc.finalizeImage(path, action, dataUrl);
        // Copying leaves the editor open so another path can be grabbed from
        // Recent; only Save & Close puts the window away.
        if (action === "save") {
          await ipc.closeEditor();
        } else {
          refreshRecent();
          showToast(action === "copy-path" ? "Path copied" : "Image copied");
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

  // Closing the window from the title bar must not silently discard work, and
  // must not let the window go either. Without preventDefault the JS layer
  // destroys it as soon as this handler resolves — behind Rust's back, so the
  // hide-to-tray rule is bypassed and the next capture has to rebuild the
  // whole WebView before it can show anything.
  useEffect(() => {
    const un = getCurrentWindow().onCloseRequested(async (event) => {
      event.preventDefault();
      await applyPending();
      await ipc.closeEditor();
    });
    return () => {
      un.then((f) => f());
    };
  }, [applyPending]);

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
      await nextPaint();
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
      setRatioId("free");
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
          case "delete": {
            // Move to the neighbouring capture rather than dismissing the
            // window — deleting a bad shot is usually mid-triage, not done.
            const index = recent.findIndex((r) => r.path === path);
            await ipc.deleteFile(path);
            const remaining = await ipc.listRecent(Math.max(12, settings.recent.limit));
            setRecent(remaining);
            const next =
              (index >= 0 ? remaining[index] : undefined) ??
              (index > 0 ? remaining[index - 1] : undefined) ??
              remaining[0];
            if (next) {
              // Not openPath: that flushes annotations, which would write the
              // file back out after it was just deleted.
              setCrop(null);
              setPath(next.path);
              showToast("Screenshot deleted");
            } else {
              await ipc.closeEditor();
            }
            break;
          }
        }
      } catch (e) {
        setError(String(e));
      }
    },
    [filename, folder, path, exportDataUrl, applyPending, recent, settings, showToast],
  );

  // ---- keyboard ------------------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (editingTextId || editingCounterId) return;
      const target = e.target as HTMLElement;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;

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
      if (e.ctrlKey && e.code === "KeyC") {
        e.preventDefault();
        finalize(e.shiftKey ? "copy-image" : "copy-path");
        return;
      }
      if (e.ctrlKey && e.code === "KeyZ") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (e.ctrlKey && e.code === "KeyY") {
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
      // With nothing selected, left/right step through Recent.
      if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && !selectedId) {
        e.preventDefault();
        if (tool === "crop") return;
        const i = recent.findIndex((r) => r.path === path);
        if (i === -1) return;
        const next = recent[i + (e.key === "ArrowRight" ? 1 : -1)];
        if (next) openPath(next.path);
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
      if (!e.ctrlKey && !e.altKey && !e.metaKey && TOOL_KEYS[e.code])
        setTool(TOOL_KEYS[e.code]);
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
    tool,
    recent,
    path,
    openPath,
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

            {tool === "crop" && crop && (
              <CropBox
                crop={crop}
                setCrop={setCrop}
                imgW={image.naturalWidth}
                imgH={image.naturalHeight}
                scale={displayScale}
                ratio={ratio}
                accent={settings.appearance.accent}
              />
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
                  // Placing the text was already an undo step, and the
                  // keystrokes were applied live on top of it, so one undo
                  // removes the whole thing — which is what you want.
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

      {/* crop controls */}
      {tool === "crop" && (
        <div className="flex shrink-0 justify-center px-4 pt-2">
          <div
            className="flex flex-wrap items-center justify-center gap-2 rounded-[12px] border px-3 py-2"
            style={{ background: "var(--panel)", borderColor: "var(--border)" }}
          >
            <span
              className="text-[12px] tabular-nums"
              style={{ color: "var(--text-2)" }}
            >
              {crop ? `${Math.round(crop.w)} × ${Math.round(crop.h)}` : "—"}
            </span>
            <div className="flex items-center gap-1">
              {RATIOS.map((r) => (
                <button
                  key={r.id}
                  onClick={() => applyRatio(r.id)}
                  className="rounded-[7px] px-2 py-1 text-[11.5px] font-medium transition-colors"
                  style={{
                    background: ratioId === r.id ? "var(--accent)" : "var(--control)",
                    color: ratioId === r.id ? "#fff" : "var(--text)",
                  }}
                >
                  {r.label}
                </button>
              ))}
            </div>
            <button
              onClick={() => {
                setCrop(null);
                setRatioId("free");
                setToolRaw("select");
              }}
              className="rounded-[7px] px-2.5 py-1 text-[12px] font-medium"
              style={{ background: "var(--control)", color: "var(--text)" }}
            >
              Cancel
            </button>
            <button
              onClick={applyCrop}
              disabled={!crop || crop.w < 16 || crop.h < 16 || busy}
              className="rounded-[7px] px-3 py-1 text-[12px] font-semibold text-white disabled:opacity-40"
              style={{ background: "var(--accent)" }}
            >
              Apply Crop
            </button>
          </div>
        </div>
      )}

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
                  ref={active ? activeThumb : undefined}
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
  const settled = useRef(false);
  const fontSize = ann.fontSize * scale;

  /** Track the typed text so the box never clips what has been written. */
  const autoSize = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${el.scrollHeight}px`;
    el.style.width = "0px";
    el.style.width = `${Math.max(el.scrollWidth + fontSize * 0.6, fontSize * 4)}px`;
  }, [fontSize]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    // Put the caret at the end so re-editing appends rather than replaces.
    el.setSelectionRange(el.value.length, el.value.length);
    autoSize();
    // Ignore a blur that arrives before the input has really settled: a
    // stray focus change on mount would otherwise discard the empty text
    // before a single character could be typed.
    const t = window.setTimeout(() => {
      settled.current = true;
    }, 250);
    return () => window.clearTimeout(t);
  }, [autoSize]);

  return (
    <textarea
      ref={ref}
      defaultValue={ann.text}
      spellCheck={false}
      rows={1}
      wrap="off"
      className="absolute z-50 resize-none overflow-hidden bg-transparent outline-none"
      style={{
        left: ann.x * scale - 2,
        top: ann.y * scale - 2,
        fontSize,
        fontWeight: 600,
        lineHeight: 1.25,
        fontFamily: '"Inter", "Segoe UI", system-ui, sans-serif',
        color: ann.color,
        caretColor: ann.color,
        textShadow: "0 1px 3px rgba(0,0,0,0.45)",
        border: "1px dashed rgba(128,128,128,0.6)",
        padding: 1,
        whiteSpace: "pre",
      }}
      onChange={(e) => {
        onChange(e.target.value);
        autoSize();
      }}
      onKeyDown={(e) => {
        // Keep tool shortcuts and Enter-to-copy out of the way while typing.
        e.stopPropagation();
        if (e.key === "Escape" || (e.key === "Enter" && (e.ctrlKey || e.metaKey))) {
          e.preventDefault();
          onDone(!(e.target as HTMLTextAreaElement).value.trim());
        }
      }}
      onBlur={(e) => {
        if (!settled.current) {
          e.target.focus();
          return;
        }
        onDone(!e.target.value.trim());
      }}
    />
  );
}
