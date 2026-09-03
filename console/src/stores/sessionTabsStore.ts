/**
 * sessionTabsStore — a per-browser-tab list of open chat tabs for the
 * DesignLayout right column ("多标签页").
 *
 * The tabs are keyed by the same `chatId` that appears in the URL
 * (`/chat/:chatId`). The active tab follows the URL, so this store only
 * tracks *which* chats have been opened and their display titles; the
 * actual switching is done by navigating the router.
 *
 * Persisted to sessionStorage so the open-tab set survives a soft reload
 * within the same browser tab (mirrors how agentStore scopes itself).
 */
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export interface SessionTab {
  /** The chat id used in `/chat/:chatId` (the effective session id). */
  chatId: string;
  /** Display title (session name). */
  title: string;
}

interface SessionTabsState {
  tabs: SessionTab[];
  openTab: (chatId: string, title?: string) => void;
  updateTitle: (chatId: string, title: string) => void;
  closeTab: (chatId: string) => void;
  /**
   * The chatId to navigate to after closing `chatId`, preferring the tab to
   * the left, falling back to the first remaining tab, else undefined.
   */
  neighborAfterClose: (chatId: string) => string | undefined;
  resetTabs: () => void;
}

export const SESSION_TABS_STORAGE_KEY = "aiarb-session-tabs";

export const DEFAULT_TITLE = "新对话";

/**
 * Whether a tab title is still an unnamed placeholder (never resolved to a
 * real session name). Callers should treat placeholder as "safe to upgrade",
 * and a real title as authoritative (persisted per chatId, independent of the
 * currently selected agent).
 */
export function isPlaceholderTitle(title: string | undefined | null): boolean {
  return !title || !title.trim() ? true : title.trim() === DEFAULT_TITLE;
}

export const useSessionTabsStore = create<SessionTabsState>()(
  persist(
    (set, get) => ({
      tabs: [],

      openTab: (chatId, title) =>
        set((state) => {
          if (state.tabs.some((t) => t.chatId === chatId)) return state;
          return {
            tabs: [
              ...state.tabs,
              { chatId, title: title?.trim() || DEFAULT_TITLE },
            ],
          };
        }),

      updateTitle: (chatId, title) =>
        set((state) => {
          const nextTitle = title?.trim();
          if (!nextTitle) return state;
          if (!state.tabs.some((t) => t.chatId === chatId && t.title !== nextTitle)) {
            return state;
          }
          return {
            tabs: state.tabs.map((t) =>
              t.chatId === chatId ? { ...t, title: nextTitle } : t,
            ),
          };
        }),

      closeTab: (chatId) =>
        set((state) => ({
          tabs: state.tabs.filter((t) => t.chatId !== chatId),
        })),

      neighborAfterClose: (chatId) => {
        const { tabs } = get();
        const index = tabs.findIndex((t) => t.chatId === chatId);
        if (index < 0) return undefined;
        const rest = tabs.filter((t) => t.chatId !== chatId);
        return (rest[index - 1] ?? rest[0])?.chatId;
      },

      resetTabs: () => set({ tabs: [] }),
    }),
    {
      name: SESSION_TABS_STORAGE_KEY,
      storage: createJSONStorage(() => sessionStorage),
    },
  ),
);