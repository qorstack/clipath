import {
  Settings as SettingsIcon,
  Crop,
  PenLine,
  FolderOutput,
  Keyboard,
  Palette,
  Clock,
  Info,
} from "lucide-react";
import {
  GeneralPage,
  CapturePage,
  AnnotationsPage,
  OutputPage,
  ShortcutsPage,
  AppearancePage,
  RecentPage,
  AboutPage,
} from "./pages";

const NAV = [
  { id: "general", label: "General", icon: SettingsIcon },
  { id: "capture", label: "Capture", icon: Crop },
  { id: "annotations", label: "Annotations", icon: PenLine },
  { id: "output", label: "Output", icon: FolderOutput },
  { id: "shortcuts", label: "Shortcuts", icon: Keyboard },
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "recent", label: "Recent", icon: Clock },
  { id: "about", label: "About", icon: Info },
];

export function SettingsWindow({
  page,
  setPage,
}: {
  page: string;
  setPage: (p: string) => void;
}) {
  const active = NAV.find((n) => n.id === page) ?? NAV[0];
  return (
    <div className="flex h-full" style={{ background: "var(--bg)" }}>
      <nav
        className="flex w-[190px] shrink-0 flex-col gap-0.5 border-r px-3 py-4"
        style={{ borderColor: "var(--border)" }}
      >
        <div className="mb-3 px-2 text-[15px] font-semibold tracking-tight">
          Clipath
        </div>
        {NAV.map((item) => {
          const Icon = item.icon;
          const isActive = item.id === active.id;
          return (
            <button
              key={item.id}
              onClick={() => setPage(item.id)}
              className="flex items-center gap-2.5 rounded-[8px] px-2.5 py-[7px] text-left text-[13px] transition-colors"
              style={{
                background: isActive ? "var(--accent)" : "transparent",
                color: isActive ? "#fff" : "var(--text)",
              }}
            >
              <Icon size={15} strokeWidth={2} />
              {item.label}
            </button>
          );
        })}
      </nav>
      <main className="flex-1 overflow-y-auto px-8 py-7">
        <h1 className="mb-5 text-[22px] font-semibold tracking-tight">
          {active.label}
        </h1>
        {active.id === "general" && <GeneralPage />}
        {active.id === "capture" && <CapturePage />}
        {active.id === "annotations" && <AnnotationsPage />}
        {active.id === "output" && <OutputPage />}
        {active.id === "shortcuts" && <ShortcutsPage />}
        {active.id === "appearance" && <AppearancePage />}
        {active.id === "recent" && <RecentPage />}
        {active.id === "about" && <AboutPage />}
      </main>
    </div>
  );
}
