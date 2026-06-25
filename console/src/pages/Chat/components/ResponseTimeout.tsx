import React, { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { ClockCircleOutlined, LoadingOutlined } from "@ant-design/icons";
import type { IAgentScopeRuntimeWebUIRef } from "@agentscope-ai/chat";

interface ResponseTimeoutProps {
  /** Whether the SDK is currently in loading state */
  isWaiting: boolean;
  /** Seconds before showing the timeout indicator */
  timeoutSeconds?: number;
  /** Chat ref for checking message content arrival */
  chatRef?: React.RefObject<IAgentScopeRuntimeWebUIRef | null>;
}

/**
 * Inline timeout indicator shown when the model hasn't started
 * responding after `timeoutSeconds`. Appears in normal document flow
 * so it never blocks overlays (security prompts, approvals, etc.).
 */
export const ResponseTimeout: React.FC<ResponseTimeoutProps> = ({
  isWaiting,
  timeoutSeconds = 45,
  chatRef,
}) => {
  const { t } = useTranslation();
  const [elapsed, setElapsed] = useState(0);
  const [hasContent, setHasContent] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Track elapsed time and poll for assistant content
  useEffect(() => {
    if (isWaiting) {
      setElapsed(0);
      setHasContent(false);

      timerRef.current = setInterval(() => {
        setElapsed((prev) => prev + 1);

        // Check if any assistant message has content — if so,
        // the model IS working, so suppress the timeout.
        if (chatRef?.current?.messages) {
          try {
            const msgs = chatRef.current.messages.getMessages();
            const lastAssistant = [...msgs]
              .reverse()
              .find((m) => m.role === "assistant");
            if (
              lastAssistant?.cards &&
              (lastAssistant.msgStatus === "generating" ||
                lastAssistant.msgStatus === "finished")
            ) {
              setHasContent(true);
            }
          } catch {
            // ignore — SDK internals may not be ready
          }
        }
      }, 1000);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      setElapsed(0);
      setHasContent(false);
    }

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [isWaiting, chatRef]);

  // Suppress when: not waiting, within grace period, or model IS responding
  if (!isWaiting || elapsed < timeoutSeconds || hasContent) {
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