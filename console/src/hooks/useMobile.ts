import { useState, useEffect } from "react";

/**
 * useMobile — 统一移动端检测 hook（StaffDeck 融合方案）。
 *
 * 基于 `window.matchMedia` 监听视口宽度，支持自定义断点。
 * 默认断点 768px（与项目既有 useIsMobile 一致）。
 *
 * @param breakpoint 最大宽度（含）判定为移动端，默认 768
 * @returns 当前视口是否处于移动端
 */
export function useMobile(breakpoint = 768): boolean {
  const [isMobile, setIsMobile] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia(`(max-width: ${breakpoint}px)`).matches,
  );

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const mql = window.matchMedia(`(max-width: ${breakpoint}px)`);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    // 同步一次，避免初始状态与 effect 之间出现漂移
    setIsMobile(mql.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, [breakpoint]);

  return isMobile;
}

export default useMobile;
