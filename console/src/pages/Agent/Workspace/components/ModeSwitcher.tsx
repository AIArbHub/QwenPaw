/**
 * ModeSwitcher — Toggle between Visual and Expert persona editing modes.
 *
 * Persists the user's choice in localStorage so the preference survives
 * across sessions.
 */
import React from "react";
import { useTranslation } from "react-i18next";
import styles from "../index.module.less";

export type EditMode = "visual" | "expert";

const STORAGE_KEY = "qwenpaw-persona-edit-mode";

export function getStoredEditMode(): EditMode {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "expert" || stored === "visual") return stored;
  } catch {
    // ignore
  }
  return "visual";
}

export function storeEditMode(mode: EditMode): void {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // ignore
  }
}

interface ModeSwitcherProps {
  mode: EditMode;
  onChange: (mode: EditMode) => void;
}

export const ModeSwitcher: React.FC<ModeSwitcherProps> = ({ mode, onChange }) => {
  const { t } = useTranslation();

  return (
    <div className={styles.modeSwitcher}>
      <button
        className={`${styles.modeBtn} ${
          mode === "visual" ? styles.modeBtnActive : ""
        }`}
        onClick={() => onChange("visual")}
        title={t("persona.visualModeTooltip")}
      >
        {t("persona.visualMode")}
      </button>
      <button
        className={`${styles.modeBtn} ${
          mode === "expert" ? styles.modeBtnActive : ""
        }`}
        onClick={() => onChange("expert")}
        title={t("persona.expertModeTooltip")}
      >
        {t("persona.expertMode")}
      </button>
    </div>
  );
};
