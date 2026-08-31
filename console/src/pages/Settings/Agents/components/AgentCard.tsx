import { memo, useState } from "react";
import { Tooltip, Modal, Dropdown } from "antd";
import type { MenuProps } from "antd";
import { useTranslation } from "react-i18next";
import {
  RobotOutlined,
  EditOutlined,
  DeleteOutlined,
  MessageOutlined,
  MoreOutlined,
  EyeInvisibleOutlined,
  EyeOutlined,
} from "@ant-design/icons";
import type { AgentSummary } from "../../../../api/types/agents";
import { getApiUrl } from "../../../../api/config";
import { getAgentDisplayName } from "../../../../utils/agentDisplayName";
import styles from "./AgentCard.module.less";

/**
 * Per-agent 统计信息（由 useAgentStatsBatch 提供）。
 * 缺失时卡片三联格显示 `--`。
 */
export interface AgentCardStats {
  sessions: number;
  messages: number;
  lastActive: string;
}

interface AgentCardProps {
  agent: AgentSummary;
  stats?: AgentCardStats;
  isSelected: boolean;
  onSelect: (agentId: string) => void;
  onEdit: (agent: AgentSummary) => void;
  onChat: (agentId: string) => void;
  onDelete: (agentId: string) => void;
  onToggle: (agentId: string, currentEnabled: boolean) => void;
}

/** Resolve a backend avatar path into a full URL for <img src>. */
function resolveAvatarSrc(avatar: string): string {
  if (!avatar) return "";
  if (/^https?:\/\//.test(avatar)) return avatar;
  const path = avatar.replace(/^\/api/, "");
  return getApiUrl(path);
}

export const AgentCard = memo(function AgentCard({
  agent,
  stats,
  isSelected,
  onSelect,
  onEdit,
  onChat,
  onDelete,
  onToggle,
}: AgentCardProps) {
  const { t } = useTranslation();
  const isDefault = agent.id === "default";
  const [avatarError, setAvatarError] = useState(false);

  const hasAvatar = Boolean(agent.avatar) && !avatarError;
  const isEnabled = agent.enabled;
  const startupInProgress =
    agent.startup_status === "pending" || agent.startup_status === "starting";

  const displayName = getAgentDisplayName(agent, t);

  const menuItems = [
    {
      key: "edit",
      label: t("agent.edit"),
      icon: <EditOutlined />,
      disabled: isDefault,
      onClick: ({ domEvent }) => {
        domEvent.stopPropagation();
        onEdit(agent);
      },
    },
    { type: "divider" as const },
    {
      key: "toggle",
      label: isEnabled ? t("agent.disable") : t("agent.enable"),
      icon: isEnabled ? <EyeInvisibleOutlined /> : <EyeOutlined />,
      disabled: isDefault || startupInProgress,
      onClick: ({ domEvent }) => {
        domEvent.stopPropagation();
        Modal.confirm({
          title: isEnabled
            ? t("agent.disableConfirm")
            : t("agent.enableConfirm"),
          content: isEnabled
            ? t("agent.disableConfirmDesc")
            : t("agent.enableConfirmDesc"),
          okText: t("common.confirm"),
          cancelText: t("common.cancel"),
          onOk: () => onToggle(agent.id, agent.enabled),
        });
      },
    },
    {
      key: "delete",
      label: t("agent.delete"),
      icon: <DeleteOutlined />,
      danger: true,
      disabled: isDefault || startupInProgress,
      onClick: ({ domEvent }) => {
        domEvent.stopPropagation();
        Modal.confirm({
          title: t("agent.deleteConfirm"),
          content: t("agent.deleteConfirmDesc"),
          okText: t("common.confirm"),
          okType: "danger",
          cancelText: t("common.cancel"),
          onOk: () => onDelete(agent.id),
        });
      },
    },
  ] as MenuProps["items"];

  const sessionsValue = stats ? String(stats.sessions) : "--";
  const messagesValue = stats ? String(stats.messages) : "--";
  const lastActiveValue = stats ? stats.lastActive : "--";

  return (
    <div
      className={`${styles.agentCard} ${isSelected ? styles.selected : ""}`}
      onClick={() => {
        onSelect(agent.id);
        if (!isDefault) {
          onEdit(agent);
        }
      }}
    >
      <Dropdown
        menu={{ items: menuItems }}
        trigger={["click"]}
        placement="bottomRight"
      >
        <button
          className={styles.moreBtn}
          onClick={(e) => e.stopPropagation()}
          aria-label={t("agent.moreActions")}
        >
          <MoreOutlined />
        </button>
      </Dropdown>

      <div className={styles.headerBar}>
        <div className={styles.avatarOverflow}>
          {hasAvatar ? (
            <img
              src={resolveAvatarSrc(agent.avatar!)}
              alt=""
              onError={() => setAvatarError(true)}
            />
          ) : (
            <RobotOutlined className={styles.avatarFallback} />
          )}
        </div>
        <div className={styles.headerInfo}>
          <div className={styles.name}>
            <span>{displayName}</span>
            {isDefault && (
              <span className={styles.defaultBadge}>{t("agent.default")}</span>
            )}
          </div>
          <div className={styles.statusRow}>
            <span
              className={`${styles.statusDot} ${
                isEnabled ? styles.online : styles.offline
              }`}
            />
            <span className={styles.statusText}>
              {isEnabled ? t("agent.online") : t("agent.offline")}
            </span>
          </div>
        </div>
        <Tooltip title={t("agent.chat")}>
          <button
            className={styles.chatBtn}
            onClick={(e) => {
              e.stopPropagation();
              onChat(agent.id);
            }}
            aria-label={t("agent.chat")}
          >
            <MessageOutlined style={{ fontSize: 14 }} />
          </button>
        </Tooltip>
      </div>

      {agent.description && (
        <Tooltip title={agent.description} placement="topLeft">
          <p className={styles.desc}>{agent.description}</p>
        </Tooltip>
      )}

      <div className={styles.statsTri}>
        <div className={styles.stat}>
          <strong>{sessionsValue}</strong>
          <em>{t("agent.statsSessions")}</em>
        </div>
        <div className={styles.stat}>
          <strong>{messagesValue}</strong>
          <em>{t("agent.statsMessages")}</em>
        </div>
        <div className={styles.stat}>
          <strong>{lastActiveValue}</strong>
          <em>{t("agent.statsLastActive")}</em>
        </div>
      </div>
    </div>
  );
});
