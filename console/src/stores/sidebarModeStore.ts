import { create } from "zustand";

const STORAGE_KEY = "qwenpaw_sidebar_mode";

export type SidebarMode = "simple" | "full" | "design";

interface SidebarModeState {
  mode: SidebarMode;
  toggleMode: () => void;
  setMode: (mode: SidebarMode) => void;
}

export const useSidebarModeStore = create<SidebarModeState>((set) => ({
  mode: (() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === "simple" || stored === "design") return stored;
      return "full";
    } catch {
      return "full";
    }
  })(),

  toggleMode: () =>
    set((state) => {
      const cycle: SidebarMode[] = ["full", "simple", "design"];
      const idx = cycle.indexOf(state.mode);
      const next = cycle[(idx + 1) % cycle.length];
      try {
        if (next === "full") {
          localStorage.removeItem(STORAGE_KEY);
        } else {
          localStorage.setItem(STORAGE_KEY, next);
        }
      } catch {
        // storage unavailable
      }
      return { mode: next };
    }),

  setMode: (mode: SidebarMode) => {
    try {
      if (mode === "full") {
        localStorage.removeItem(STORAGE_KEY);
      } else {
        localStorage.setItem(STORAGE_KEY, mode);
      }
    } catch {
      // storage unavailable
    }
    set({ mode });
  },
}));
