import React, { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { LoadingOutlined, ClockCircleOutlined } from "@ant-design/icons";

interface ResponseTimeoutProps {
  isWaiting: boolean;
  timeoutSeconds?: number;
}

export const ResponseTimeout: React.FC<ResponseTimeoutProps> = ({
  isWaiting,
  timeoutSeconds = 45,
}) => {
  const { t } = useTranslation();
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (isWaiting) {
      // Start tracking elapsed time
      setElapsed(0);
      timerRef.current = setInterval(() => {
        setElapsed((prev) => prev + 1);
      }, 1000);
    } else {
      // Reset on response
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      setElapsed(0);
    }

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [isWaiting]);

  // Don't show anything if not waiting, or within timeout window
  if (!isWaiting || elapsed < timeoutSeconds) {
    return null;
  }

  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;
  const timeStr = minutes > 0 ? `${minutes}m${seconds}s` : `${seconds}s`;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "10px 16px",
        margin: "0 16px 8px",
        borderRadius: 8,
        background: "var(--ant-color-warning-bg, #fffbe6)",
        border: "1px solid var(--ant-color-warning-border, #ffe58f)",
        fontSize: 13,
        color: "var(--ant-color-warning-text, #ad6800)",
        flexShrink: 0,
      }}
    >
      <ClockCircleOutlined style={{ fontSize: 16, opacity: 0.7 }} />
      <span style={{ flex: 1 }}>
        {t("chat.queue.longResponseTime")}
        <span style={{ marginLeft: 6, opacity: 0.7 }}>({timeStr})</span>
      </span>
      <LoadingOutlined spin style={{ fontSize: 14, opacity: 0.5 }} />
    </div>
  );
};