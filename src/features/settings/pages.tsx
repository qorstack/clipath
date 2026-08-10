import { useEffect, useMemo, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { convertFileSrc } from "@tauri-apps/api/core";
import { Copy, ExternalLink, FolderOpen, Trash2 } from "lucide-react";
import { ipc } from "../../lib/ipc";
import { useSettings } from "../../lib/settings";
import { Button, Row, Section, Select, SliderRow, Toggle } from "../../components/ui";
import { ShortcutRecorder } from "../shortcuts/ShortcutRecorder";
import type { RecentItem, Settings } from "../../types";
import logoUrl from "../../assets/clipath-logo.png";

// ---------------------------------------------------------------------------

export function GeneralPage() {
  const { settings, update } = useSettings();
  if (!settings) return null;
  const g = settings.general;
  return (
    <>
      <Section>
        <Row title="Launch Clipath at Windows startup">
          <Toggle
            checked={g.launchAtStartup}
            onChange={(v) => update({ general: { launchAtStartup: v } })}
          />
        </Row>
        <Row
          title="Keep Clipath running in system tray"
          subtitle="Closing the window hides it instead of quitting, so the capture shortcut keeps working"
        >
          <Toggle
            checked={g.minimizeToTray}
            onChange={(v) => update({ general: { minimizeToTray: v } })}
          />
        </Row>
        <Row title="Show capture completion notification">
          <Toggle
            checked={g.notifications}
            onChange={(v) => update({ general: { notifications: v } })}
          />
        </Row>
      </Section>
      <Section title="Maintenance">
        <Row title="Reset onboarding" subtitle="Show the welcome flow again">
          <Button onClick={() => update({ onboardingCompleted: false })}>
            Reset
          </Button>
        </Row>
        <Row title="Reset all settings">
          <Button
            variant="destructive"
            onClick={async () => {
              const fresh = await ipc.getSettings();
              // Keep the folder; reset everything else via defaults on the Rust side.
              await update({
                onboardingCompleted: false,
                output: { folder: fresh.output.folder },
              });
            }}
          >
            Reset
          </Button>
        </Row>
      </Section>
    </>
  );
}

// ---------------------------------------------------------------------------

export function CapturePage() {
  const { settings, update } = useSettings();
  if (!settings) return null;
  const c = settings.capture;
  return (
    <Section>
      <Row title="Show selection dimensions">
        <Toggle
          checked={c.showDimensions}
          onChange={(v) => update({ capture: { showDimensions: v } })}
        />
      </Row>
      <Row
        title="Show capture magnifier"
        subtitle="Pixel-precision loupe while selecting"
      >
        <Toggle
          checked={c.showMagnifier}
          onChange={(v) => update({ capture: { showMagnifier: v } })}
        />
      </Row>
      <Row title="Show crosshair guides">
        <Toggle
          checked={c.crosshairGuides}
          onChange={(v) => update({ capture: { crosshairGuides: v } })}
        />
      </Row>
      <Row
        title="Remember previous region"
        subtitle="Enables the Capture Previous Region action"
      >
        <Toggle
          checked={c.rememberPreviousRegion}
          onChange={(v) => update({ capture: { rememberPreviousRegion: v } })}
        />
      </Row>
    </Section>
  );
}

// ---------------------------------------------------------------------------

const TOOLS = [
  { value: "select", label: "Select" },
  { value: "arrow", label: "Arrow" },
  { value: "line", label: "Line" },
  { value: "rect", label: "Rectangle" },
  { value: "ellipse", label: "Ellipse" },
  { value: "pen", label: "Pen" },
  { value: "highlighter", label: "Highlighter" },
  { value: "text", label: "Text" },
  { value: "blur", label: "Blur" },
  { value: "pixelate", label: "Pixelate" },
  { value: "counter", label: "Step Counter" },
] as const;

export function AnnotationsPage() {
  const { settings, update } = useSettings();
  if (!settings) return null;
  const a = settings.annotations;
  return (
    <>
      <Section>
        <Row title="Default tool">
          <Select
            value={a.defaultTool}
            options={TOOLS as any}
            onChange={(v) => update({ annotations: { defaultTool: v as any } })}
          />
        </Row>
        <Row title="Default color">
          <input
            type="color"
            value={a.defaultColor}
            onChange={(e) =>
              update({ annotations: { defaultColor: e.target.value } })
            }
            className="h-7 w-10 cursor-pointer rounded border-0 bg-transparent"
          />
        </Row>
        <Row title="Stroke width">
          <SliderRow
            value={a.strokeWidth}
            min={1}
            max={12}
            onChange={(v) => update({ annotations: { strokeWidth: v } })}
            format={(v) => `${v} px`}
          />
        </Row>
        <Row title="Pen smoothing">
          <Toggle
            checked={a.penSmoothing}
            onChange={(v) => update({ annotations: { penSmoothing: v } })}
          />
        </Row>
        <Row title="Highlighter opacity">
          <SliderRow
            value={a.highlighterOpacity}
            min={0.1}
            max={0.8}
            step={0.05}
            onChange={(v) => update({ annotations: { highlighterOpacity: v } })}
            format={(v) => `${Math.round(v * 100)}%`}
          />
        </Row>
        <Row title="Text size">
          <SliderRow
            value={a.fontSize}
            min={10}
            max={64}
            onChange={(v) => update({ annotations: { fontSize: v } })}
            format={(v) => `${v} px`}
          />
        </Row>
        <Row title="Blur strength">
          <SliderRow
            value={a.blurStrength}
            min={4}
            max={40}
            onChange={(v) => update({ annotations: { blurStrength: v } })}
          />
        </Row>
        <Row title="Pixelation size">
          <SliderRow
            value={a.pixelSize}
            min={4}
            max={40}
            onChange={(v) => update({ annotations: { pixelSize: v } })}
          />
        </Row>
        <Row title="Step counter size">
          <SliderRow
            value={a.counterSize}
            min={18}
            max={56}
            onChange={(v) => update({ annotations: { counterSize: v } })}
            format={(v) => `${v} px`}
          />
        </Row>
        <Row title="Step counter starts at">
          <input
            type="number"
            min={0}
            value={a.counterStart}
            onChange={(e) =>
              update({ annotations: { counterStart: Number(e.target.value) } })
            }
            className="w-[70px] text-[13px]"
          />
        </Row>
      </Section>
      <Section title="Behavior">
        <Row title="Remember last selected tool">
          <Toggle
            checked={a.rememberLastTool}
            onChange={(v) => update({ annotations: { rememberLastTool: v } })}
          />
        </Row>
        <Row title="Remember last selected color">
          <Toggle
            checked={a.rememberLastColor}
            onChange={(v) => update({ annotations: { rememberLastColor: v } })}
          />
        </Row>
        <Row title="Show toolbar tooltips">
          <Toggle
            checked={a.showTooltips}
            onChange={(v) => update({ annotations: { showTooltips: v } })}
          />
        </Row>
      </Section>
    </>
  );
}

// ---------------------------------------------------------------------------

function renderPatternPreview(pattern: string, ext: string): string {
  const now = new Date();
  const pad = (n: number, l = 2) => String(n).padStart(l, "0");
  return (
    pattern
      .replace("{yyyy}", String(now.getFullYear()))
      .replace("{MM}", pad(now.getMonth() + 1))
      .replace("{dd}", pad(now.getDate()))
      .replace("{HH}", pad(now.getHours()))
      .replace("{mm}", pad(now.getMinutes()))
      .replace("{ss}", pad(now.getSeconds()))
      .replace("{fff}", pad(now.getMilliseconds(), 3))
      .replace("{counter}", "1")
      .replace("{width}", "1280")
      .replace("{height}", "720")
      .replace("{app}", "") + `.${ext}`
  );
}

const PATH_FORMATS = [
  { value: "{path}", label: "Plain" },
  { value: '"{path}"', label: "Quoted" },
  { value: "file-uri", label: "File URI" },
  { value: "![Screenshot]({path})", label: "Markdown Image" },
  { value: "@{path}", label: "@ Mention" },
  { value: "custom", label: "Custom…" },
];

export function OutputPage() {
  const { settings, update } = useSettings();
  const [folderError, setFolderError] = useState<string | null>(null);
  if (!settings) return null;
  const o = settings.output;
  const ext = o.format === "jpeg" ? "jpg" : o.format;
  const isPreset = PATH_FORMATS.some(
    (f) => f.value === o.pathFormat && f.value !== "custom",
  );

  const changeFolder = async () => {
    const picked = await open({ directory: true, defaultPath: o.folder });
    if (typeof picked !== "string") return;
    try {
      await ipc.validateFolder(picked);
      setFolderError(null);
      await update({ output: { folder: picked } });
    } catch (e) {
      setFolderError(String(e));
    }
  };

  return (
    <>
      <Section title="Screenshot folder">
        <Row title="Save screenshots to" subtitle={o.folder}>
          <Button onClick={changeFolder}>Change…</Button>
          <Button onClick={() => ipc.openPath(o.folder)}>Open folder</Button>
        </Row>
        {folderError && (
          <div className="py-2 text-[12px]" style={{ color: "var(--destructive)" }}>
            {folderError}
          </div>
        )}
      </Section>

      <Section title="File naming">
        <Row title="Filename pattern">
          <input
            type="text"
            value={o.filenamePattern}
            spellCheck={false}
            onChange={(e) =>
              update({ output: { filenamePattern: e.target.value } })
            }
            className="w-[320px] font-mono text-[12px]"
          />
        </Row>
        <Row
          title="Preview"
          subtitle={renderPatternPreview(o.filenamePattern, ext)}
        />
      </Section>

      <Section title="File format">
        <Row title="Format">
          <Select
            value={o.format}
            options={[
              { value: "png", label: "PNG" },
              { value: "jpeg", label: "JPEG" },
              { value: "webp", label: "WebP (lossless)" },
            ]}
            width={140}
            onChange={(v) => update({ output: { format: v as any } })}
          />
        </Row>
        {o.format === "jpeg" && (
          <Row title="Quality">
            <SliderRow
              value={o.quality}
              min={40}
              max={100}
              onChange={(v) => update({ output: { quality: v } })}
            />
          </Row>
        )}
      </Section>

      <Section title="After capture">
        <Row title="Pressing Enter" subtitle="The default final action">
          <Select
            value={o.defaultFinalAction}
            options={[
              { value: "copy-path", label: "Copy Path" },
              { value: "copy-image", label: "Copy Image" },
              { value: "save", label: "Save & Close" },
            ]}
            onChange={(v) => update({ output: { defaultFinalAction: v as any } })}
          />
        </Row>
        <Row title="Path copy format">
          <Select
            value={isPreset ? o.pathFormat : "custom"}
            options={PATH_FORMATS}
            onChange={(v) =>
              update({
                output: {
                  pathFormat: v === "custom" ? "Review this screenshot: \"{path}\"" : v,
                },
              })
            }
          />
        </Row>
        {!isPreset && (
          <Row
            title="Custom template"
            subtitle="Variables: {path} {filename} {folder} {width} {height} {date} {time}"
          >
            <input
              type="text"
              value={o.pathFormat}
              spellCheck={false}
              onChange={(e) => update({ output: { pathFormat: e.target.value } })}
              className="w-[280px] font-mono text-[12px]"
            />
          </Row>
        )}
      </Section>
    </>
  );
}

// ---------------------------------------------------------------------------

const SHORTCUT_ROWS: {
  key: keyof Settings["shortcuts"];
  label: string;
}[] = [
  { key: "region", label: "Capture Region" },
  { key: "fullscreen", label: "Capture Full Screen" },
  { key: "activeWindow", label: "Capture Active Window" },
  { key: "previousRegion", label: "Capture Previous Region" },
  { key: "copyLastPath", label: "Copy Last Path" },
  { key: "openFolder", label: "Open Screenshots Folder" },
  { key: "openSettings", label: "Open Settings" },
];

export function ShortcutsPage() {
  const { settings, update } = useSettings();
  const [errors, setErrors] = useState<string[]>([]);
  if (!settings) return null;
  const s = settings.shortcuts;
  return (
    <>
      <Section>
        {SHORTCUT_ROWS.map((row) => (
          <Row key={row.key} title={row.label}>
            <ShortcutRecorder
              value={s[row.key]}
              conflicts={SHORTCUT_ROWS.filter((r) => r.key !== row.key).map(
                (r) => s[r.key],
              )}
              onChange={async (v) => {
                const errs = await update({ shortcuts: { [row.key]: v } });
                setErrors(errs);
              }}
            />
          </Row>
        ))}
      </Section>
      {errors.length > 0 && (
        <div className="text-[12px]" style={{ color: "var(--destructive)" }}>
          {errors.map((e, i) => (
            <div key={i}>{e}</div>
          ))}
        </div>
      )}
      <Button
        onClick={async () => {
          // Asked for rather than written down here: a second copy of the list
          // goes stale, and this one did — it handed back Ctrl+Shift+A for
          // releases after that stopped being the default.
          const shortcuts = await ipc.defaultShortcuts();
          setErrors(await update({ shortcuts }));
        }}
      >
        Reset to defaults
      </Button>
    </>
  );
}

// ---------------------------------------------------------------------------

export const ACCENTS = [
  { value: "#0A84FF", label: "Blue" },
  { value: "#5E5CE6", label: "Indigo" },
  { value: "#BF5AF2", label: "Purple" },
  { value: "#FF375F", label: "Pink" },
  { value: "#FF3B30", label: "Red" },
  { value: "#FF9500", label: "Orange" },
  { value: "#FFD60A", label: "Yellow" },
  { value: "#34C759", label: "Green" },
  { value: "#00C7BE", label: "Teal" },
  { value: "#8E8E93", label: "Graphite" },
];

export function AccentPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex max-w-[300px] flex-wrap items-center justify-end gap-2">
      {ACCENTS.map((c) => (
        <button
          key={c.value}
          title={c.label}
          aria-label={c.label}
          onClick={() => onChange(c.value)}
          className="h-6 w-6 rounded-full transition-transform hover:scale-110"
          style={{
            background: c.value,
            boxShadow:
              value.toUpperCase() === c.value
                ? "0 0 0 2px var(--bg), 0 0 0 4px var(--accent)"
                : "none",
          }}
        />
      ))}
    </div>
  );
}

export function AppearancePage() {
  const { settings, update } = useSettings();
  if (!settings) return null;
  const a = settings.appearance;
  return (
    <>
      <Section>
        <Row title="Theme">
          <Select
            value={a.theme}
            options={[
              { value: "system", label: "System" },
              { value: "light", label: "Light" },
              { value: "dark", label: "Dark" },
            ]}
            width={140}
            onChange={(v) => update({ appearance: { theme: v as any } })}
          />
        </Row>
        <Row title="Accent">
          <AccentPicker
            value={a.accent}
            onChange={(v) => update({ appearance: { accent: v } })}
          />
        </Row>
        <Row title="Custom accent">
          <input
            type="color"
            value={a.accent}
            onChange={(e) => update({ appearance: { accent: e.target.value } })}
            className="h-7 w-10 cursor-pointer rounded border-0 bg-transparent"
          />
        </Row>
      </Section>
    </>
  );
}

// ---------------------------------------------------------------------------

export function RecentPage() {
  const { settings, update } = useSettings();
  const [items, setItems] = useState<RecentItem[]>([]);
  const limit = settings?.recent.limit ?? 50;

  const refresh = () => {
    ipc.listRecent(limit).then(setItems).catch(console.error);
  };
  useEffect(refresh, [limit]);

  const groups = useMemo(() => {
    const today = new Date().toDateString();
    const map = new Map<string, RecentItem[]>();
    for (const item of items) {
      const d = new Date(item.modified);
      const key = d.toDateString() === today ? "Today" : d.toLocaleDateString();
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(item);
    }
    return [...map.entries()];
  }, [items]);

  if (!settings) return null;
  return (
    <>
      <Section>
        <Row title="Number of captures to show">
          <Select
            value={String(limit)}
            options={[
              { value: "20", label: "20" },
              { value: "50", label: "50" },
              { value: "100", label: "100" },
            ]}
            width={90}
            onChange={(v) => update({ recent: { limit: Number(v) } })}
          />
        </Row>
      </Section>
      {groups.length === 0 && (
        <p className="text-[13px]" style={{ color: "var(--text-2)" }}>
          No captures yet.
        </p>
      )}
      {groups.map(([label, groupItems]) => (
        <div key={label} className="mb-5">
          <div
            className="mb-2 px-1 text-[12px] font-semibold"
            style={{ color: "var(--text-2)" }}
          >
            {label}
          </div>
          <div
            className="divide-y rounded-[12px] border"
            style={{ background: "var(--panel)", borderColor: "var(--border)" }}
          >
            {groupItems.map((item) => (
              <div
                key={item.path}
                className="group flex items-center gap-3 border-t px-3 py-2 first:border-t-0"
                style={{ borderColor: "var(--border)" }}
              >
                <img
                  src={convertFileSrc(item.path)}
                  alt=""
                  className="h-10 w-14 shrink-0 rounded-[6px] object-cover"
                  style={{ background: "var(--control)" }}
                  loading="lazy"
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12.5px]">{item.filename}</div>
                  <div className="text-[11.5px]" style={{ color: "var(--text-2)" }}>
                    {new Date(item.modified).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </div>
                </div>
                <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                  <IconBtn title="Copy Path" onClick={() => ipc.copyPathText(item.path)}>
                    <Copy size={14} />
                  </IconBtn>
                  <IconBtn title="Open" onClick={() => ipc.openPath(item.path)}>
                    <ExternalLink size={14} />
                  </IconBtn>
                  <IconBtn
                    title="Open folder"
                    onClick={() => ipc.revealInFolder(item.path)}
                  >
                    <FolderOpen size={14} />
                  </IconBtn>
                  <IconBtn
                    title="Delete"
                    onClick={async () => {
                      await ipc.deleteFile(item.path);
                      refresh();
                    }}
                  >
                    <Trash2 size={14} />
                  </IconBtn>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}

function IconBtn({
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
      className="rounded-[6px] p-1.5 transition-colors"
      style={{ color: "var(--text-2)" }}
      onMouseEnter={(e) =>
        ((e.currentTarget as HTMLElement).style.background = "var(--control)")
      }
      onMouseLeave={(e) =>
        ((e.currentTarget as HTMLElement).style.background = "transparent")
      }
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------

export function AboutPage() {
  const [info, setInfo] = useState<{ version: string; configDir: string }>();
  const { settings } = useSettings();
  useEffect(() => {
    ipc.appInfo().then(setInfo);
  }, []);
  return (
    <div className="flex flex-col items-center pt-8 text-center">
      <img
        src={logoUrl}
        alt=""
        draggable={false}
        className="app-logo mb-5 h-[88px] w-[88px] select-none object-contain"
      />
      <div className="text-[18px] font-semibold">Clipath</div>
      <div className="mt-1 text-[13px]" style={{ color: "var(--text-2)" }}>
        Version {info?.version ?? "1.0.0"}
      </div>
      <div className="mt-3 text-[13px]" style={{ color: "var(--text-2)" }}>
        Capture. Annotate. Paste the path.
      </div>
      <div className="mt-7 flex gap-3">
        <Button onClick={() => info && ipc.openPath(info.configDir)}>
          App data folder
        </Button>
        {settings && (
          <Button onClick={() => ipc.openPath(settings.output.folder)}>
            Screenshots folder
          </Button>
        )}
      </div>
      <p className="mt-8 text-[12px]" style={{ color: "var(--text-2)" }}>
        MIT License · Local-first, no uploads, no accounts.
      </p>
    </div>
  );
}
