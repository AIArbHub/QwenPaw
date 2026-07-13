/**
 * browseFolder — unified folder picker that works in both Tauri desktop
 * and browser/web modes.
 *
 * - Tauri: uses @tauri-apps/plugin-dialog (native OS picker, returns path).
 * - Web:   calls backend POST /api/utils/select-folder which opens a native
 *          tkinter dialog on the server side (backend runs locally).
 *
 * Falls back gracefully: if Tauri is unavailable AND the backend call fails
 * (e.g. headless server / no tkinter), returns null so the caller can let
 * the user type the path manually.
 */
import { isTauri } from "@tauri-apps/api/core";
import { request } from "@/api/request";

let _tauriDialog: typeof import("@tauri-apps/plugin-dialog") | null = null;

async function _getTauriDialog() {
  if (_tauriDialog) return _tauriDialog;
  try {
    _tauriDialog = await import("@tauri-apps/plugin-dialog");
    return _tauriDialog;
  } catch {
    return null;
  }
}

export interface BrowseFolderResult {
  /** Absolute path to the selected folder, or null if cancelled/unavailable. */
  path: string | null;
  /** True when the user explicitly cancelled (vs. errors). */
  cancelled: boolean;
}

export async function browseFolder(
  /** Starting directory hint (only used in Tauri mode for now). */
  startDir?: string,
): Promise<BrowseFolderResult> {
  // 1) Tauri mode — native OS folder picker
  if (isTauri()) {
    const dialog = await _getTauriDialog();
    if (dialog) {
      try {
        const selected = await dialog.open({
          directory: true,
          multiple: false,
          ...(startDir ? { defaultPath: startDir } : {}),
        });
        if (selected && typeof selected === "string") {
          return { path: selected, cancelled: false };
        }
        return { path: null, cancelled: true };
      } catch {
        // Tauri dialog failed — fall through to API fallback
      }
    }
  }

  // 2) Web mode — delegate to the backend's native dialog
  try {
    const res = await request<{ path: string | null; cancelled: boolean }>(
      "/utils/select-folder",
      {
        method: "POST",
        ...(startDir
          ? { body: JSON.stringify({ start_dir: startDir }) }
          : {}),
      },
    );
    return res;
  } catch {
    // Backend unavailable or tkinter missing — let caller handle
    return { path: null, cancelled: false };
  }
}
