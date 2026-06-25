import React, { useState, useEffect, useRef } from "react";
import { Alert } from "@agentscope-ai/design";
import { LoadingOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";

interface ResponseTimeoutProps {
  isWaiting: boolean;
  timeoutSeconds?: number;
}

export const ResponseTimeout: React.FC<ResponseTimeoutProps> = ({
  isWaiting,
  timeoutSeconds = 30,
}) => {
  const { t } = useTranslation();
  const [showWarning, setShowWarning] = useState(false);
  const timeoutRef = useRef<NodeJS.Timeout>();

  useEffect(() => {
    if (isWaiting) {
      // 重置状态
      setShowWarning(false);
      
      // 设置超时检测
      timeoutRef.current = setTimeout(() => {
        setShowWarning(true);
      }, timeoutSeconds * 1000);
    } else {
      // 清除超时检测
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      setShowWarning(false);
    }

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [isWaiting, timeoutSeconds]);

  if (!showWarning || !isWaiting) {
    return null;
  }

  return (
    <Alert
      type="warning"
      showIcon
      icon={<LoadingOutlined spin />}
      message={
        <span>
          {t("chat.queue.longResponseTime")}
          <br />
          <span style={{ fontSize: "12px", opacity: 0.8 }}>
            {t("chat.queue.checkConnection")}
          </span>
        </span>
      }
      style={{
        position: "fixed",
        bottom: "100px",
        right: "24px",
        zIndex: 1000,
        maxWidth: "400px",
        boxShadow: "0 4px 12px rgba(0, 0, 0, 0.15)",
        animation: "fadeIn 0.3s ease-in-out",
      }}
    />
  );
};