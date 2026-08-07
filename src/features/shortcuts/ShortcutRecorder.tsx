import { useEffect, useRef, useState } from "react";
import { ipc } from "../../lib/ipc";

/** Convert a KeyboardEvent into a canonical "Ctrl+Shift+A" style string, or
 * null while only modifiers are held. */
export function eventToShortcut(e: KeyboardEvent): string | null {
  const mods: string[] = [];
  if (e.ctrlKey) mods.push("Ctrl");
  if (e.altKey) mods.push("Alt");
  if (e.shiftKey) mods.push("Shift");
  if (e.metaKey) mods.push("Win");

  const code = e.code;
  if (["ControlLeft", "ControlRight", "AltLeft", "AltRight", "ShiftLeft", "ShiftRight", "MetaLeft", "MetaRight"].includes(code)) {
    return null;
  }
  let key: string;
  if (code.startsWith("Key")) key = code.slice(3);
  else if (code.startsWith("Digit")) key = code.slice(5);
  else key = code; // F1..F24, Space, Home, ArrowUp, PrintScreen, ...
  if (!key) return null;
  return [...mods, key].join("+");
}

const KEY_LABELS: Record<string, string> = {
  Comma: ",",
  Period: ".",
  Slash: "/",
  Semicolon: ";",
  Quote: "'",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  Minus: "-",
  Equal: "=",
  Backquote: "`",
};

/** Render W3C key codes the way a user reads them: "Comma" -> ",". */
export function humanize(shortcut: string): string {
  return shortcut
    .split("+")
    .map((p) => KEY_LABELS[p] ?? p)
    .join("+");
}

function isSafeGlobal(shortcut: string): boolean {
  const parts = shortcut.split("+");
  const key = parts[parts.length - 1];
  const hasMod = parts.length > 1;
  // Allow F-keys and PrintScreen without modifiers; anything else needs one.
  if (/^F\d{1,2}$/.test(key) || key === "PrintScreen") return true;
  return hasMod && !["Shift"].every((m) => parts.slice(0, -1).includes(m) && parts.length === 2 && m === "Shift");
}

export function ShortcutRecorder({
  value,
  onChange,
  conflicts = [],
}: {
  value: string | null;
  onChange: (v: string | null) => void;
  /** Other shortcuts currently assigned in Clipath (to detect duplicates). */
  conflicts?: (string | null)[];
}) {
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLButtonElement>(null);

  // While recording, drop all of Clipath's global shortcuts so pressing the
  // current hotkey records it instead of triggering a capture.
  useEffect(() => {
    if (recording) {
      ipc.suspendShortcuts().catch(() => {});
      return () => {
        ipc.resumeShortcuts().catch(() => {});
      };
    }
  }, [recording]);

  useEffect(() => {
    if (!recording) return;
    const handler = async (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.code === "Escape") {
        setRecording(false);
        return;
      }
      const sc = eventToShortcut(e);
      if (!sc) return;
      if (!isSafeGlobal(sc)) {
        setError("Add a modifier key (Ctrl / Alt / Win)");
        return;
      }
      if (conflicts.filter(Boolean).includes(sc)) {
        setError("Already used by another Clipath shortcut");
        return;
      }
      try {
        const ok = await ipc.checkShortcutAvailable(sc);
        if (!ok) {
          setError("In use by another application");
          return;
        }
      } catch {
        setError("Invalid shortcut");
        return;
      }
      setError(null);
      setRecording(false);
      onChange(sc);
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [recording, conflicts, onChange]);

  useEffect(() => {
    if (!recording) setError(null);
  }, [recording]);

  return (
    <div className="flex items-center gap-2">
      {error && (
        <span className="text-[12px]" style={{ color: "var(--destructive)" }}>
          {error}
        </span>
      )}
      <button
        ref={ref}
        onClick={() => setRecording(!recording)}
        onBlur={() => setRecording(false)}
        className="min-w-[130px] rounded-[8px] border px-3 py-1.5 text-center text-[12px] font-medium"
        style={{
          background: recording ? "var(--accent-soft)" : "var(--control)",
          borderColor: recording ? "var(--accent)" : "var(--border)",
          color: recording ? "var(--accent)" : value ? "var(--text)" : "var(--text-2)",
        }}
      >
        {recording ? "Press shortcut…" : value ? humanize(value) : "—"}
      </button>
      {value && !recording && (
        <button
          onClick={() => onChange(null)}
          className="rounded px-1.5 py-1 text-[12px] hover:opacity-70"
          style={{ color: "var(--text-2)" }}
          title="Clear shortcut"
        >
          ✕
        </button>
      )}
    </div>
  );
}
