import { create } from "zustand";
import { agentApi } from "../api/modules/agent";

const STORAGE_KEY = "aiarb_group_chat_native_enabled";

/**
 * Whether the native group-chat runtime should be used when the target
 * agent is a group-chat host (carries `<!-- HOST:{...} -->` metadata).
 *
 * Default: **true** — the native runtime does NOT affect regular
 * single-agent chats (it only activates for host agents with the
 * metadata marker), so it is safe to enable by default.
 *
 * The setting is persisted in two places:
 * 1. **localStorage** — for instant UI reads (no network round-trip).
 * 2. **config.json (backend)** — via `/workspace/group-chat-native` API,
 *    so it is automatically included in global config backups.
 *
 * On startup, the store reads from localStorage for the initial value
 * and then asynchronously syncs with the backend config. If the
 * backend has a different value, the backend value takes priority and
 * localStorage is updated to match.
 */
export interface GroupChatSettingsState {
  /** Whether the native group-chat runtime is enabled. */
  enabled: boolean;
  /** Whether the store has finished syncing with the backend. */
  synced: boolean;
  /** Toggle the native runtime on/off (persists to both stores). */
  setEnabled: (enabled: boolean) => void;
  /** Convenience: flip the current value. */
  toggle: () => void;
  /** Sync from backend config.json. Called on app init. */
  syncFromBackend: () => Promise<void>;
}

function readStored(): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    // Default to true (enabled) when no stored value exists.
    // Stored value "0" / "false" → disabled; anything else → enabled.
    if (raw === null) return true;
    return raw !== "0" && raw !== "false";
  } catch {
    return true;
  }
}

function persistLocal(enabled: boolean): void {
  try {
    if (enabled) {
      // Remove the key entirely so "enabled" is the implicit default
      // (matches the pattern used by sidebarModeStore).
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, "0");
    }
  } catch {
    // storage unavailable (private mode, quota, etc.)
  }
}

export const useGroupChatSettingsStore = create<GroupChatSettingsState>(
  (set, get) => ({
    enabled: readStored(),
    synced: false,

    setEnabled: (enabled: boolean) => {
      // Optimistic local update
      persistLocal(enabled);
      set({ enabled });
      // Fire-and-forget backend sync
      agentApi.updateGroupChatNative(enabled).catch(() => {
        // Backend update failed — local state still reflects user intent.
        // The per-request flag from frontend will still carry the setting.
      });
    },

    toggle: () => {
      const next = !get().enabled;
      get().setEnabled(next);
    },

    syncFromBackend: async () => {
      try {
        const res = await agentApi.getGroupChatNative();
        const backendEnabled = res.group_chat_native_enabled;
        // Backend is source of truth — sync local to match
        persistLocal(backendEnabled);
        set({ enabled: backendEnabled, synced: true });
      } catch {
        // Backend unavailable — keep local value, mark as synced to
        // avoid blocking; the per-request flag will still carry it.
        set({ synced: true });
      }
    },
  }),
);
