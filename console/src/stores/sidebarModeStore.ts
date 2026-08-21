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
      if (stored === "simple" || stored === "design" || stored === "full")
        return stored;
      return "design";
    } catch {
      return "design";
    }
  })(),

  toggleMode: () =>
    set((state) => {
      // toggleMode only cycles between simple ↔ full (preserves existing
      // behaviour).  Design mode has its own dedicated entry point in the
      // settings panel.
      const next: SidebarMode = state.mode === "simple" ? "full" : "simple";
      try {
        if (next === "simple") {
          localStorage.setItem(STORAGE_KEY, "simple");
        } else {
          localStorage.removeItem(STORAGE_KEY);
        }
      } catch {
        // storage unavailable
      }
      return { mode: next };
    }),

  setMode: (mode: SidebarMode) => {
    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      // storage unavailable
    }
    set({ mode });
  },
}));
