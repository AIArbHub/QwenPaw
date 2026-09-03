/**
 * chatWorkspaceStore — session store for the experimental multi-instance chat
 * workspace ("ChatMultiInstance").
 *
 * FROZEN / EXPERIMENTAL — A1 adopted.
 *
 * This module is preserved as an experimental asset. The A1 route (single
 * runtime + URL-driven tabs on `/chat`) has been adopted as the product
 * entry point (see `chat-architecture-a1-and-group-chat-hitl.md` D3).
 * No new features will be added here.
 *
 * This is an ISOLATED experimental surface. It is NOT URL-driven like the
 * legacy `/chat/*` tabs: each tab keeps a ChatPage instance mounted and alive
 * in memory, switching only changes visibility. Because the underlying chat
 * runtime is heavy, governance here caps the number of concurrently-mounted
 * instances (`MAX_TABS`) and evicts the least-recently-used idle tab when the
 * cap is reached.
 *
 * A tab is keyed by a stable client `key`, decoupled from `chatId` so that a
 * brand-new blank chat (no backend id yet) can still be represented before the
 * first message resolves it.
 */
import { create } from "zustand";

/** Local timestamp id scheme matches `sessionApi`'s new-blank-chat ids. */
function makeLocalChatId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export interface WorkspaceTab {
  /** Stable client-side identity (decoupled from the chat id). */
  key: string;
  /** The chat id handed to ChatPage. null before a backend session exists. */
  chatId: string | null;
  /** Agent binding for this tab. */
  agentId: string;
  /** Display title (session name or placeholder). */
  title: string;
  /** Monotonic recency stamp used for LRU eviction. */
  lastActiveAt: number;
}

export const MAX_TABS = 10;

interface ChatWorkspaceState {
  tabs: WorkspaceTab[];
  activeKey: string | null;
  /** Open (or focus) a tab for an agent. chatId may be omitted for a new chat. */
  openTab: (agentId: string, chatId?: string | null, title?: string) => void;
  closeTab: (key: string) => void;
  activate: (key: string) => void;
}

let seq = 0;
function nextKey(): string {
  seq += 1;
  return `ws-${Date.now()}-${seq}`;
}

export const useChatWorkspaceStore = create<ChatWorkspaceState>()((set) => ({
  tabs: [],
  activeKey: null,

  openTab: (agentId, chatId, title) =>
    set((state) => {
      const resolvedId = chatId ?? makeLocalChatId();
      const now = Date.now();
      // Re-focus an existing tab for the same chat id under this agent.
      const existing = state.tabs.find(
        (t) => t.agentId === agentId && t.chatId === resolvedId,
      );
      if (existing) {
        return {
          tabs: state.tabs.map((t) =>
            t.key === existing.key ? { ...t, lastActiveAt: now } : t,
          ),
          activeKey: existing.key,
        };
      }

      let tabs = [...state.tabs];
      let activeKey = nextKey();
      const tab: WorkspaceTab = {
        key: activeKey,
        chatId: resolvedId,
        agentId,
        title: title?.trim() || "新对话",
        lastActiveAt: now,
      };

      // Governance: never exceed MAX_TABS. Drop the idle-est non-active tab.
      while (tabs.length >= MAX_TABS) {
        const sorted = [...tabs].sort((a, b) => a.lastActiveAt - b.lastActiveAt);
        const victim = sorted[0];
        tabs = tabs.filter((t) => t.key !== victim.key);
      }

      return { tabs: [...tabs, tab], activeKey: tab.key };
    }),

  closeTab: (key) =>
    set((state) => {
      const tabs = state.tabs.filter((t) => t.key !== key);
      if (state.activeKey !== key) return { tabs };
      // Closing the active tab: prefer its left neighbour, else the first,
      // else null (empty workspace → welcome empty state).
      const index = state.tabs.findIndex((t) => t.key === key);
      const rest = tabs;
      const next = (rest[index - 1] ?? rest[0])?.key ?? null;
      return { tabs, activeKey: next };
    }),

  activate: (key) =>
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.key === key ? { ...t, lastActiveAt: Date.now() } : t,
      ),
      activeKey: key,
    })),
}));