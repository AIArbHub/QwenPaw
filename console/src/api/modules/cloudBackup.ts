import { request } from "../request";
import { getApiUrl } from "../config";
import { buildAuthHeaders } from "../authHeaders";
import type {
  CloudBackupConfig,
  CloudBackupEntry,
  CloudBackupListResponse,
  CloudSyncResponse,
} from "../types/cloudBackup";

export const cloudBackupApi = {
  getConfig: () => request<CloudBackupConfig>("/cloud-backups/config"),

  saveConfig: (config: CloudBackupConfig) =>
    request<{ ok: boolean }>("/cloud-backups/config", {
      method: "PUT",
      body: JSON.stringify(config),
    }),

  checkConnection: () =>
    request<{ connected: boolean }>("/cloud-backups/check", {
      method: "POST",
    }),

  listCloudBackups: () =>
    request<CloudBackupListResponse>("/cloud-backups/list"),

  uploadBackup: (backupId: string) =>
    request<CloudBackupEntry>(`/cloud-backups/upload/${encodeURIComponent(backupId)}`, {
      method: "POST",
    }),

  syncAll: () =>
    request<CloudSyncResponse>("/cloud-backups/sync", {
      method: "POST",
    }),

  deleteCloudBackup: (key: string) =>
    request<{ ok: boolean }>(
      `/cloud-backups/${encodeURIComponent(key)}`,
      { method: "DELETE" },
    ),

  downloadCloudBackup: async (key: string, filename: string) => {
    const url = getApiUrl(
      `/cloud-backups/download/${encodeURIComponent(key)}`,
    );
    const headers = buildAuthHeaders();
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`Download failed: ${res.status}`);
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(blobUrl);
  },

  restoreFromCloud: async (key: string, trustMode = "portable") => {
    const url = getApiUrl(
      `/cloud-backups/restore/${encodeURIComponent(key)}?trust_mode=${trustMode}`,
    );
    const headers = buildAuthHeaders();
    const res = await fetch(url, {
      method: "POST",
      headers,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(text || `Restore failed: ${res.status}`);
    }
    return res.json();
  },
};
