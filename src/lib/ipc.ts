import { invoke } from "@tauri-apps/api/core";
import type { FinalAction, OverlayData, RecentItem, Settings } from "../types";

export const ipc = {
  getSettings: () => invoke<Settings>("get_settings"),
  setSettings: (settings: Settings) =>
    invoke<string[]>("set_settings", { settings }),
  validateFolder: (path: string) => invoke<void>("validate_folder", { path }),
  getDefaultFolder: () => invoke<string>("get_default_folder"),
  checkShortcutAvailable: (shortcut: string) =>
    invoke<boolean>("check_shortcut_available", { shortcut }),
  suspendShortcuts: () => invoke<void>("suspend_shortcuts"),
  resumeShortcuts: () => invoke<string[]>("resume_shortcuts"),
  appInfo: () => invoke<{ version: string; configDir: string }>("app_info"),

  // capture overlay
  triggerCapture: (mode: string) => invoke<void>("trigger_capture", { mode }),
  getOverlayInfo: (monitor: number) =>
    invoke<OverlayData>("get_overlay_info", { monitor }),
  getOverlayFrame: (monitor: number) =>
    invoke<ArrayBuffer>("get_overlay_frame", { monitor }),
  overlayReady: (monitor: number) => invoke<void>("overlay_ready", { monitor }),
  commitRegion: (monitor: number, x: number, y: number, w: number, h: number) =>
    invoke<string>("commit_region", { monitor, x, y, w, h }),
  cancelCapture: () => invoke<void>("cancel_capture"),

  // editor
  readImage: (path: string) => invoke<ArrayBuffer>("read_image", { path }),
  finalizeImage: (path: string, action: FinalAction, imageBase64: string) =>
    invoke<string>("finalize_image", { path, action, imageBase64 }),
  saveImageAs: (target: string, imageBase64: string) =>
    invoke<void>("save_image_as", { target, imageBase64 }),
  closeEditor: () => invoke<void>("close_editor"),

  // files / clipboard / history
  listRecent: (limit: number) => invoke<RecentItem[]>("list_recent", { limit }),
  copyPathText: (path: string) => invoke<void>("copy_path_text", { path }),
  copyText: (text: string) => invoke<void>("copy_text", { text }),
  copyImageFile: (path: string) => invoke<void>("copy_image_file", { path }),
  deleteFile: (path: string) => invoke<void>("delete_file", { path }),
  revealInFolder: (path: string) => invoke<void>("reveal_in_folder", { path }),
  openPath: (path: string) => invoke<void>("open_path", { path }),
  pinFile: (path: string) => invoke<void>("pin_file", { path }),
  getPinPath: (label: string) => invoke<string>("get_pin_path", { label }),
  hideMainWindow: () => invoke<void>("hide_main_window"),
};
