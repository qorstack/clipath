import { useEffect, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { getCurrentWindow, PhysicalSize } from "@tauri-apps/api/window";
import { X } from "lucide-react";
import { ipc } from "../../lib/ipc";

const OPACITIES = [1, 0.9, 0.75, 0.5];

export function PinView({ label }: { label: string }) {
  const [path, setPath] = useState<string | null>(null);
  const [hover, setHover] = useState(false);
  const [opacity, setOpacity] = useState(1);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const original = useRef<PhysicalSize | null>(null);
  const zoom = useRef(1);

  useEffect(() => {
    ipc.getPinPath(label).then(setPath).catch(console.error);
    const win = getCurrentWindow();
    win.innerSize().then((s) => {
      original.current = s;
      win.show();
    });
  }, [label]);

  const applyZoom = async (factor: number) => {
    if (!original.current) return;
    zoom.current = Math.min(4, Math.max(0.2, zoom.current * factor));
    const win = getCurrentWindow();
    await win.setSize(
      new PhysicalSize(
        Math.max(80, Math.round(original.current.width * zoom.current)),
        Math.max(60, Math.round(original.current.height * zoom.current)),
      ),
    );
  };

  const resetZoom = async () => {
    if (!original.current) return;
    zoom.current = 1;
    await getCurrentWindow().setSize(original.current);
  };

  const close = () => getCurrentWindow().close();

  if (!path) return null;

  const MENU_ITEMS: { label: string; action?: () => void; sub?: boolean }[] = [
    { label: "Copy Path", action: () => ipc.copyPathText(path) },
    { label: "Copy Image", action: () => ipc.copyImageFile(path) },
    { label: "Open File", action: () => ipc.openPath(path) },
    { label: "Open Folder", action: () => ipc.revealInFolder(path) },
  ];

  return (
    <div
      className="relative h-screen w-screen overflow-hidden"
      style={{ borderRadius: 12, opacity }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => {
        setHover(false);
        setMenu(null);
      }}
      onDoubleClick={resetZoom}
      onWheel={(e) => applyZoom(e.deltaY < 0 ? 1.1 : 0.9)}
      onContextMenu={(e) => {
        e.preventDefault();
        setMenu({ x: e.clientX, y: e.clientY });
      }}
    >
      <img
        src={convertFileSrc(path)}
        alt="Pinned screenshot"
        data-tauri-drag-region
        draggable={false}
        className="h-full w-full select-none object-fill"
        style={{ borderRadius: 12, pointerEvents: menu ? "none" : "auto" }}
      />
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          borderRadius: 12,
          boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.25), inset 0 0 0 2px rgba(0,0,0,0.15)",
        }}
      />
      {hover && !menu && (
        <button
          onClick={close}
          aria-label="Unpin"
          className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full text-white transition-opacity hover:opacity-80"
          style={{ background: "rgba(20,20,22,0.75)" }}
        >
          <X size={13} strokeWidth={2.5} />
        </button>
      )}
      {menu && (
        <div
          className="panel-shadow absolute z-50 min-w-[150px] rounded-[10px] border py-1"
          style={{
            left: Math.min(menu.x, window.innerWidth - 160),
            top: Math.min(menu.y, window.innerHeight - 230),
            background: "var(--elevated)",
            borderColor: "var(--border)",
            backdropFilter: "blur(20px)",
          }}
        >
          {MENU_ITEMS.map((item) => (
            <MenuButton
              key={item.label}
              onClick={() => {
                item.action?.();
                setMenu(null);
              }}
            >
              {item.label}
            </MenuButton>
          ))}
          <div className="my-1 h-px" style={{ background: "var(--border)" }} />
          <div className="flex items-center gap-1 px-3 py-1">
            {OPACITIES.map((o) => (
              <button
                key={o}
                onClick={() => {
                  setOpacity(o);
                  setMenu(null);
                }}
                className="rounded px-1.5 py-0.5 text-[11px] font-medium"
                style={{
                  background: opacity === o ? "var(--accent)" : "var(--control)",
                  color: opacity === o ? "#fff" : "var(--text)",
                }}
              >
                {Math.round(o * 100)}%
              </button>
            ))}
          </div>
          <div className="my-1 h-px" style={{ background: "var(--border)" }} />
          <MenuButton onClick={close}>Unpin</MenuButton>
        </div>
      )}
    </div>
  );
}

function MenuButton({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="block w-full px-3 py-1.5 text-left text-[12.5px] transition-colors"
      style={{ color: "var(--text)" }}
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
