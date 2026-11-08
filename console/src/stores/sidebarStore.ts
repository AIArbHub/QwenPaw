import { create } from "zustand";

import { isFixedSidebarItemId } from "@/constants/sidebarItems";

const FOCUS_ITEMS_STORAGE_KEY = "qwenpaw_sidebar_focus_items_v4";
const HIDDEN_PLUGIN_ITEMS_STORAGE_KEY =
  "qwenpaw_sidebar_hidden_plugin_items_v4";
const LEGACY_FOCUS_ITEMS_KEY = "qwenpaw_sidebar_focus_items_v3";
const LEGACY_HIDDEN_PLUGIN_ITEMS_KEY =
  "qwenpaw_sidebar_hidden_plugin_items_v3";

export const DEFAULT_FOCUS_ITEM_IDS = [
  // High-frequency agent-scoped items
  "core.memory",
  "core.knowledge-base",
  "core.document-tools",
  "core.skills",
  "core.cron-jobs",
  "core.files",
  // Settings items
  "core.agents",
  "core.models",
];

interface SidebarStoreState {
  focusItemIds: string[];
  hiddenPluginItemIds: string[];
  setFocusItemIds: (itemIds: string[]) => void;
  setSidebarItemVisible: (itemId: string, visible: boolean) => void;
  setSidebarItemsVisible: (itemIds: string[], visible: boolean) => void;
  invertSidebarItems: (itemIds: string[]) => void;
  resetFocusItemIds: () => void;
}

interface SidebarVisibilityState {
  focusItemIds: string[];
  hiddenPluginItemIds: string[];
}

function loadFocusItemIds(): string[] {
  try {
    const stored = localStorage.getItem(FOCUS_ITEMS_STORAGE_KEY);
    if (!stored) {
      // v4 upgrade: clean break from v3. The old v3 default had 11 items,
      // still too noisy. v4 curates an even more concise set of 7 items.
      // We do NOT inherit the v3 list because it was auto-generated.
      // Just clean up the legacy key and start fresh.
      localStorage.removeItem(LEGACY_FOCUS_ITEMS_KEY);
      return [...DEFAULT_FOCUS_ITEM_IDS];
    }
    const parsed: unknown = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [...DEFAULT_FOCUS_ITEM_IDS];
    return parsed.filter(
      (itemId): itemId is string =>
        typeof itemId === "string" && !isFixedSidebarItemId(itemId),
    );
  } catch {
    return [...DEFAULT_FOCUS_ITEM_IDS];
  }
}

function persistFocusItemIds(itemIds: string[]) {
  try {
    localStorage.setItem(FOCUS_ITEMS_STORAGE_KEY, JSON.stringify(itemIds));
  } catch {
    // storage unavailable
  }
}

function loadHiddenPluginItemIds(): string[] {
  try {
    let stored = localStorage.getItem(HIDDEN_PLUGIN_ITEMS_STORAGE_KEY);
    if (!stored) {
      // Migrate from v2 if present.
      stored = localStorage.getItem(LEGACY_HIDDEN_PLUGIN_ITEMS_KEY);
      if (stored) {
        localStorage.removeItem(LEGACY_HIDDEN_PLUGIN_ITEMS_KEY);
        // Persist migrated value to v2 key.
      }
    }
    const parsed: unknown = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];
    const result = parsed.filter(
      (itemId): itemId is string =>
        typeof itemId === "string" && !itemId.startsWith("core."),
    );
    // If we read from the legacy key, persist to the new key.
    if (stored && !localStorage.getItem(HIDDEN_PLUGIN_ITEMS_STORAGE_KEY)) {
      persistHiddenPluginItemIds(result);
    }
    return result;
  } catch {
    return [];
  }
}

function persistHiddenPluginItemIds(itemIds: string[]) {
  try {
    localStorage.setItem(
      HIDDEN_PLUGIN_ITEMS_STORAGE_KEY,
      JSON.stringify(itemIds),
    );
  } catch {
    // storage unavailable
  }
}

function updateSidebarItemsVisibility(
  state: SidebarVisibilityState,
  itemIds: string[],
  resolveVisible: (currentlyVisible: boolean) => boolean,
): SidebarVisibilityState {
  const focusItemIds = new Set(state.focusItemIds);
  const hiddenPluginItemIds = new Set(state.hiddenPluginItemIds);
  const configurableItemIds = [...new Set(itemIds)].filter(
    (itemId) => !isFixedSidebarItemId(itemId),
  );

  for (const itemId of configurableItemIds) {
    if (itemId.startsWith("core.")) {
      const visible = resolveVisible(focusItemIds.has(itemId));
      if (visible) focusItemIds.add(itemId);
      else focusItemIds.delete(itemId);
    } else {
      const visible = resolveVisible(!hiddenPluginItemIds.has(itemId));
      if (visible) hiddenPluginItemIds.delete(itemId);
      else hiddenPluginItemIds.add(itemId);
    }
  }

  const next = {
    focusItemIds: [...focusItemIds],
    hiddenPluginItemIds: [...hiddenPluginItemIds],
  };
  persistFocusItemIds(next.focusItemIds);
  persistHiddenPluginItemIds(next.hiddenPluginItemIds);
  return next;
}

export const useSidebarStore = create<SidebarStoreState>((set) => ({
  focusItemIds: loadFocusItemIds(),
  hiddenPluginItemIds: loadHiddenPluginItemIds(),

  setFocusItemIds: (itemIds: string[]) => {
    const next = [...new Set(itemIds)].filter(
      (itemId) => !isFixedSidebarItemId(itemId),
    );
    persistFocusItemIds(next);
    set({ focusItemIds: next });
  },

  setSidebarItemVisible: (itemId, visible) =>
    set((state) => {
      if (isFixedSidebarItemId(itemId)) return state;

      if (itemId.startsWith("core.")) {
        const next = visible
          ? [...new Set([...state.focusItemIds, itemId])]
          : state.focusItemIds.filter((current) => current !== itemId);
        persistFocusItemIds(next);
        return { focusItemIds: next };
      }

      const hiddenPluginItemIds = visible
        ? state.hiddenPluginItemIds.filter((current) => current !== itemId)
        : [...new Set([...state.hiddenPluginItemIds, itemId])];
      persistHiddenPluginItemIds(hiddenPluginItemIds);
      return { hiddenPluginItemIds };
    }),

  setSidebarItemsVisible: (itemIds, visible) =>
    set((state) => updateSidebarItemsVisibility(state, itemIds, () => visible)),

  invertSidebarItems: (itemIds) =>
    set((state) =>
      updateSidebarItemsVisibility(
        state,
        itemIds,
        (currentlyVisible) => !currentlyVisible,
      ),
    ),

  resetFocusItemIds: () => {
    persistFocusItemIds(DEFAULT_FOCUS_ITEM_IDS);
    persistHiddenPluginItemIds([]);
    set({
      focusItemIds: [...DEFAULT_FOCUS_ITEM_IDS],
      hiddenPluginItemIds: [],
    });
  },
}));
