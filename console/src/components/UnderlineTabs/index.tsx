import React from "react";
import styles from "./index.module.less";

export interface UnderlineTabsItem {
  key: string;
  label: string;
  /** Optional count badge displayed after the label. */
  count?: number;
}

export interface UnderlineTabsProps {
  items: UnderlineTabsItem[];
  active: string;
  onChange: (key: string) => void;
  /** Visual variant: "line" (default) shows a 2px underline on the active tab;
   *  "dot" renders the count as a small dot badge instead of a number. */
  variant?: "dot" | "line";
}

/**
 * UnderlineTabs — StaffDeck 风格的下划线选项卡。
 *
 * 高度 36px，文字 14px，选中态 font-weight: 600 + 底部 2px 实线。
 * 默认色 --sd-muted-2，选中 --sd-ink，hover --sd-ink-soft。
 * 使用 --sd-* CSS 变量，暗色模式自动适配。
 */
export const UnderlineTabs: React.FC<UnderlineTabsProps> = ({
  items,
  active,
  onChange,
  variant = "line",
}) => {
  return (
    <div className={styles.tabs} role="tablist">
      {items.map((item) => {
        const isActive = active === item.key;
        const showCount = item.count !== undefined && item.count > 0;
        return (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={isActive}
            className={`${styles.tab} ${isActive ? styles.active : ""}`}
            onClick={() => onChange(item.key)}
          >
            <span className={styles.label}>{item.label}</span>
            {showCount && (
              <span
                className={`${styles.count} ${
                  variant === "dot" ? styles.countDot : ""
                }`}
              >
                {variant === "dot" ? "" : item.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
};

export default UnderlineTabs;
