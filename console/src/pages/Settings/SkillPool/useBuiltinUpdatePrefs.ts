/**
 * useBuiltinUpdatePrefs — 持久化用户对内置技能更新的偏好到 localStorage。
 *
 * 三态策略：
 * - "safe_update"  — 用户未改的技能自动更新（默认）
 * - "ask"          — 每次都询问
 * - "never"        — 从不自动更新
 */
import { useCallback, useEffect, useState } from "react";

export type BuiltinUpdatePolicy = "safe_update" | "ask" | "never";

interface BuiltinUpdatePrefs {
  policy: BuiltinUpdatePolicy;
}

const STORAGE_KEY = "aiarb.skill-pool.builtin-update-prefs";

const DEFAULT_PREFS: BuiltinUpdatePrefs = {
  policy: "safe_update",
};

function readPrefs(): BuiltinUpdatePrefs {
  if (typeof window === "undefined") return DEFAULT_PREFS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw);
    if (parsed?.policy === "safe_update" || parsed?.policy === "ask" || parsed?.policy === "never") {
      return { policy: parsed.policy };
    }
  } catch {
    // ignore
  }
  return DEFAULT_PREFS;
}

function writePrefs(prefs: BuiltinUpdatePrefs): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // ignore
  }
}

export function useBuiltinUpdatePrefs() {
  const [prefs, setPrefs] = useState<BuiltinUpdatePrefs>(() => readPrefs());

  useEffect(() => {
    writePrefs(prefs);
  }, [prefs]);

  const setPolicy = useCallback((policy: BuiltinUpdatePolicy) => {
    setPrefs({ policy });
  }, []);

  return { policy: prefs.policy, setPolicy };
}
