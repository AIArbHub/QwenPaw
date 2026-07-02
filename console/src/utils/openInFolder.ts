import { invoke, isTauri } from "@tauri-apps/api/core";

export interface OpenInFolderResult {
  success: boolean;
  reason?: "not_tauri" | "error";
  path: string;
  error?: unknown;
}

export async function openInFolder(path: string): Promise<OpenInFolderResult> {
  if (!path) {
    return { success: false, reason: "error", path };
  }

  if (!isTauri()) {
    return { success: false, reason: "not_tauri", path };
  }

  try {
    await invoke("open_in_folder", { path });
    return { success: true, path };
  } catch (error) {
    console.warn("[open-folder] Tauri command failed", error);
    return { success: false, reason: "error", path, error };
  }
}

export function deriveSkillPoolDir(workspaceDir: string): string | undefined {
  const normalized = workspaceDir.replace(/\\/g, "/");
  const match = normalized.match(/^(.+)\/workspaces\/[^/]+$/);
  if (!match) return undefined;
  const workingDir = workspaceDir.substring(0, match[1].length);
  const sep = workspaceDir.includes("\\") ? "\\" : "/";
  return `${workingDir}${sep}skill_pool`;
}