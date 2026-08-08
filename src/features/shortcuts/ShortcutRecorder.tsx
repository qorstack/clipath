import { useEffect, useRef, useState } from "react";
import { ipc } from "../../lib/ipc";
import { eventToShortcut, humanize, isSafeGlobal } from "./keys";

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
