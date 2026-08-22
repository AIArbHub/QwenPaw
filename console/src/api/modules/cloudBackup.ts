import { request } from "../request";
import { getApiUrl } from "../config";
import { buildAuthHeaders } from "../authHeaders";
import type {
  CloudBackupConfig,
  CloudBackupListResponse,
  CloudBackupEntry,
  CloudSyncResponse,
} from "../types/cloudBackup";

export const cloudBackupApi = {
  getConfig: () =>
    request<CloudBackupConfig>("/cloud-backups/config"),

  saveConfig: (config: CloudBackupConfig) =>
    request<{ ok: boolean }>("/cloud-backups/config", {
      method: "PUT",
      body: JSON.stringify(config),
    }),

  checkConnection: () =>
    request<{
      connected: boolean;
      status_code: number | null;
      error: string | null;
      detail: string | null;
    }>("/cloud-backups/check", {
      method: "POST",
    }),

  listCloudBackups: () =>
    request<CloudBackupListResponse>("/cloud-backups/list"),

  uploadToCloud: (backupId: string) =>
    request<CloudBackupEntry>(`/cloud-backups/upload/${backupId}`, {
      method: "POST",
    }),

  syncAll: () =>
    request<CloudSyncResponse>("/cloud-backups/sync", {
      method: "POST",
    }),

  downloadFromCloud: async (cloudKey: string) => {
    const url = getApiUrl(`/cloud-backups/download/${cloudKey}`);
    const res = await fetch(url, {
      headers: buildAuthHeaders(),
    });
    if (!res.ok) {
      throw new Error(`Download failed: ${res.status}`);
    }
    return res.blob();
  },

  restoreFromCloud: (cloudKey: string, trustMode?: string) =>
    request<{ id: string; name: string }>(
      `/cloud-backups/restore/${cloudKey}?trust_mode=${trustMode ?? ""}`,
      { method: "POST" },
    ),

  deleteCloudBackup: (cloudKey: string) =>
    request<{ ok: boolean }>(`/cloud-backups/${cloudKey}`, {
      method: "DELETE",
    }),
};
