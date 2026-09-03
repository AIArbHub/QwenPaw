/**
 * GroupChatControlBar — a compact panel showing each group-chat member's
 * current controller state (auto / human / assist) and allowing quick
 * takeover / release / assist-hint editing.
 *
 * Mounts inside the chat page when a group chat session is detected.
 * Fetches state from the backend GET /api/console/group-chats endpoint
 * and calls PATCH for controller changes.
 */
import { useEffect, useState, useCallback } from "react";
import { Tag, Tooltip, Input, Button, Spin } from "antd";
import { UserOutlined, RobotOutlined, BulbOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import {
  groupChatsApi,
  type GroupChatMemberInfo,
} from "../../api/modules/groupChats";

interface GroupChatControlBarProps {
  hostAgentId: string;
  sessionId: string;
}

function ControllerTag({
  controller,
  t,
}: {
  controller: string;
  t: (key: string, fallback?: string) => string;
}) {
  if (controller === "human") {
    return (
      <Tag icon={<UserOutlined />} color="orange">
        {t("chat.groupChat.humanControlled", "人工")}
      </Tag>
    );
  }
  if (controller === "assist") {
    return (
      <Tag icon={<BulbOutlined />} color="blue">
        {t("chat.groupChat.assistMode", "协助")}
      </Tag>
    );
  }
  return (
    <Tag icon={<RobotOutlined />} color="green">
      {t("chat.groupChat.autoMode", "自动")}
    </Tag>
  );
}

export default function GroupChatControlBar({
  hostAgentId,
  sessionId,
}: GroupChatControlBarProps) {
  const { t } = useTranslation();
  const [members, setMembers] = useState<GroupChatMemberInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [assistEditId, setAssistEditId] = useState<string | null>(null);
  const [assistText, setAssistText] = useState("");
  const [round, setRound] = useState(0);
  const [scriptPhase, setScriptPhase] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!hostAgentId || !sessionId) return;
    try {
      const state = await groupChatsApi.getGroupChat(hostAgentId, sessionId);
      setMembers(state.members);
      setRound(state.round);
      setScriptPhase(state.script_phase);
    } catch {
      // Not a group chat or not found — hide silently
    } finally {
      setLoading(false);
    }
  }, [hostAgentId, sessionId]);

  useEffect(() => {
    setLoading(true);
    void refresh();
    // Poll every 3 seconds for state updates while the panel is mounted
    const interval = setInterval(refresh, 3000);
    return () => clearInterval(interval);
  }, [refresh]);

  const handleSetController = async (
    memberId: string,
    controller: "auto" | "human" | "assist",
    assistHint?: string,
  ) => {
    try {
      await groupChatsApi.setController({
        host_agent_id: hostAgentId,
        session_id: sessionId,
        member_id: memberId,
        controller,
        assist_hint: assistHint,
      });
      await refresh();
    } catch (e) {
      console.warn("[GroupChatControlBar] setController failed", e);
    }
  };

  if (loading) {
    return (
      <div style={{ padding: 8, textAlign: "center" }}>
        <Spin size="small" />
      </div>
    );
  }

  if (members.length === 0) return null;

  return (
    <div
      style={{
        padding: "6px 12px",
        borderBottom: "1px solid var(--ant-color-border-secondary, #f0f0f0)",
        display: "flex",
        flexWrap: "wrap",
        gap: 8,
        alignItems: "center",
      }}
    >
      {scriptPhase && (
        <Tag color="purple" style={{ fontSize: 11 }}>
          {scriptPhase} · R{round}
        </Tag>
      )}
      {members.map((m) => (
        <div
          key={m.agent_id}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            padding: "2px 6px",
            borderRadius: 4,
            background: "var(--ant-color-fill-tertiary, rgba(0,0,0,0.04))",
          }}
        >
          <span style={{ fontSize: 12, fontWeight: 500 }}>
            {m.name || m.agent_id}
          </span>
          <ControllerTag controller={m.controller} t={t} />
          {m.human_pending && (
            <Tooltip title={t("chat.groupChat.waitingForHuman", "等待您发言…")}>
              <span style={{ fontSize: 11, color: "#fa8c16" }}>⏳</span>
            </Tooltip>
          )}
          {m.override_count > 0 && (
            <Tooltip
              title={t(
                "chat.groupChat.overrideCount",
                `人工干预 ${m.override_count} 次`,
              )}
            >
              <span style={{ fontSize: 11, color: "#999" }}>
                ×{m.override_count}
              </span>
            </Tooltip>
          )}
          {/* Controller switch buttons */}
          {m.controller !== "human" && (
            <Button
              size="small"
              type="link"
              style={{ fontSize: 11, padding: "0 4px" }}
              onClick={() => handleSetController(m.agent_id, "human")}
            >
              {t("chat.groupChat.takeover", "接管")}
            </Button>
          )}
          {m.controller === "human" && (
            <Button
              size="small"
              type="link"
              style={{ fontSize: 11, padding: "0 4px" }}
              onClick={() => handleSetController(m.agent_id, "auto")}
            >
              {t("chat.groupChat.release", "交还")}
            </Button>
          )}
          {m.controller !== "assist" && (
            <Button
              size="small"
              type="link"
              style={{ fontSize: 11, padding: "0 4px" }}
              onClick={() => setAssistEditId(m.agent_id)}
            >
              {t("chat.groupChat.assist", "协助")}
            </Button>
          )}
          {/* Assist hint editor */}
          {assistEditId === m.agent_id && (
            <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
              <Input
                size="small"
                style={{ width: 120 }}
                placeholder={t(
                  "chat.groupChat.assistHintPlaceholder",
                  "输入发言方向…",
                )}
                value={assistText || m.assist_hint}
                onChange={(e) => setAssistText(e.target.value)}
              />
              <Button
                size="small"
                type="primary"
                onClick={() => {
                  void handleSetController(
                    m.agent_id,
                    "assist",
                    assistText || undefined,
                  );
                  setAssistEditId(null);
                  setAssistText("");
                }}
              >
                {t("common.confirm", "确定")}
              </Button>
              <Button
                size="small"
                onClick={() => setAssistEditId(null)}
              >
                {t("common.cancel", "取消")}
              </Button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
