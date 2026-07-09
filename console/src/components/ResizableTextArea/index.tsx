import { useState, useRef, useCallback, useEffect } from "react";
import styles from "./index.module.less";

const MIN_HEIGHT = 80;
const MAX_HEIGHT_RATIO = 0.85;

interface ResizableTextAreaProps {
  /** 默认高度（px） */
  defaultHeight?: number;
  /** 占位符 */
  placeholder?: string;
  /** 当前值 */
  value?: string;
  /** 默认值 */
  defaultValue?: string;
  /** 值变化回调 */
  onChange?: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  /** 是否只读 */
  readOnly?: boolean;
  /** 自定义样式 */
  style?: React.CSSProperties;
  /** 自定义类名 */
  className?: string;
  /** 是否自动聚焦 */
  autoFocus?: boolean;
  /** 等宽字体（用于 JSON/代码编辑） */
  monospace?: boolean;
}

/**
 * 可拖拽调整大小的 TextArea 组件。
 *
 * 使用原生 <textarea> 而非 antd Input.TextArea，
 * 因为 antd 的包装层会覆盖 CSS resize 和 height 属性。
 * 方案与技能页 MarkdownCopy 组件一致：自定义 resizeHandle + 鼠标事件。
 */
export function ResizableTextArea({
  defaultHeight = 120,
  placeholder,
  value,
  defaultValue,
  onChange,
  readOnly,
  style,
  className,
  autoFocus,
  monospace = false,
}: ResizableTextAreaProps) {
  const [height, setHeight] = useState(defaultHeight);
  const resizingRef = useRef(false);
  const startYRef = useRef(0);
  const startHeightRef = useRef(0);

  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      resizingRef.current = true;
      startYRef.current = e.clientY;
      startHeightRef.current = height;

      const handleMouseMove = (moveEvent: MouseEvent) => {
        if (!resizingRef.current) return;
        const delta = moveEvent.clientY - startYRef.current;
        const maxH = window.innerHeight * MAX_HEIGHT_RATIO;
        const newHeight = Math.max(
          MIN_HEIGHT,
          Math.min(maxH, startHeightRef.current + delta),
        );
        setHeight(newHeight);
      };

      const handleMouseUp = () => {
        resizingRef.current = false;
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };

      document.body.style.cursor = "ns-resize";
      document.body.style.userSelect = "none";
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    },
    [height],
  );

  useEffect(() => {
    return () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, []);

  return (
    <div className={`${styles.wrapper} ${className || ""}`}>
      <textarea
        className={`${styles.textarea} ${monospace ? styles.monospace : ""}`}
        style={{ ...style, height }}
        value={value}
        defaultValue={defaultValue}
        onChange={onChange}
        placeholder={placeholder}
        readOnly={readOnly}
        autoFocus={autoFocus}
      />
      <div
        className={styles.resizeHandle}
        onMouseDown={handleResizeStart}
      />
    </div>
  );
}
