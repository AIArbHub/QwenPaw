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
  CopyOutlined,
} from "@ant-design/icons";
import { Pin, PinOff, Tag, PawPrint, SquareTerminal, History } from "lucide-react";
import type { AgentSummary } from "../../../../api/types/agents";
import { getApiUrl } from "../../../../api/config";
import { getAgentDisplayName } from "../../../../utils/agentDisplayName";
import { providerIcon } from "../../Models/components/providerIcon";
import styles from "./AgentCard.module.less";

/**
 * Per-agent 统计信息（由 useAgentStatsBatch 提供）。
 * 缺失时卡片三联格显示 `--`。
 */
export interface AgentCardStats {
  sessions: number;
  messages?: number;
  lastActive: string;
}

interface AgentCardProps {
  agent: AgentSummary;
  stats?: AgentCardStats;
  isSelected: boolean;
  onSelect: (agentId: string) => void;
  onEdit: (agent: AgentSummary) => void;
  onChat: (agentId: string) => void;
  onHistory: (agentId: string) => void;
  onDelete: (agentId: string) => void;
  onToggle: (agentId: string, currentEnabled: boolean) => void;
  onPin: (agentId: string, currentPinned: boolean) => void;
  onCopy: (agent: AgentSummary) => void;
  onFilterByGroup?: (group: string) => void;
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
  onHistory,
  onDelete,
  onToggle,
  onPin,
  onCopy,
  onFilterByGroup,
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
      key: "pin",
      label: agent.pinned ? t("agent.unpinAgent") : t("agent.pinAgent"),
      icon: agent.pinned ? <PinOff size={14} /> : <Pin size={14} />,
      disabled: isDefault,
      onClick: ({ domEvent }) => {
        domEvent.stopPropagation();
        onPin(agent.id, Boolean(agent.pinned));
      },
    },
    {
      key: "copy",
      label: t("agent.copyAgent", "复制智能体"),
      icon: <CopyOutlined />,
      onClick: ({ domEvent }) => {
        domEvent.stopPropagation();
        onCopy(agent);
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
  const lastActiveValue = stats ? stats.lastActive : "--";

  return (
    <div
      className={`${styles.agentCard} ${isSelected ? styles.selected : ""}`}
      onClick={() => {
        // Card click only selects the agent; no longer auto-opens the
        // edit drawer. Use the name area or the "more" menu to edit.
        onSelect(agent.id);
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
        <div
          className={styles.headerInfo}
          onClick={(e) => {
            // Click on the name/info area opens the edit drawer.
            e.stopPropagation();
            if (!isDefault) {
              onEdit(agent);
            }
          }}
          role="button"
          tabIndex={0}
          title={isDefault ? undefined : t("agent.edit")}
        >
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

      {/* Meta row: group + backend + model */}
      <div className={styles.metaRow}>
        {agent.group && (
          <button
            type="button"
            className={styles.groupTag}
            onClick={(e) => {
              e.stopPropagation();
              onFilterByGroup?.(agent.group!);
            }}
            title={t("agent.filterByGroup", "按分组筛选")}
          >
            <Tag size={10} />
            {agent.group}
          </button>
        )}
        {agent.id !== "default" && (
          <span className={styles.backendTag}>
            {agent.backend !== "aiarb" ? (
              <SquareTerminal size={10} />
            ) : (
              <PawPrint size={10} />
            )}
            {agent.backend !== "aiarb" ? agent.backend : "AIArb"}
          </span>
        )}
        {agent.id !== "default" && agent.active_model && (
          <span className={styles.modelTag}>
            <img
              src={providerIcon(agent.active_model.provider_id)}
              alt=""
              style={{ width: 12, height: 12 }}
            />
            {agent.active_model.model}
          </span>
        )}
        {agent.id !== "default" &&
          agent.backend !== "aiarb" &&
          agent.backend_model && (
            <span className={styles.modelTag}>
              <SquareTerminal size={12} />
              {agent.backend_model}
            </span>
          )}
      </div>

      <div className={styles.statsTri}>
        <button
          type="button"
          className={styles.stat}
          onClick={(e) => {
            e.stopPropagation();
            onChat(agent.id);
          }}
          title={t("agent.statsSessionsGo", "查看会话")}
          disabled={sessionsValue === "--"}
        >
          <strong>{sessionsValue}</strong>
          <em>{t("agent.statsSessions")}</em>
        </button>
        <button
          type="button"
          className={styles.stat}
          onClick={(e) => {
            e.stopPropagation();
            onHistory(agent.id);
          }}
          title={t("agent.statsHistoryGo", "查看历史记录")}
        >
          <History size={14} className={styles.statIcon} />
          <em>{t("agent.statsHistory", "历史")}</em>
        </button>
        <div className={styles.stat}>
          <strong>{lastActiveValue}</strong>
          <em>{t("agent.statsLastActive")}</em>
        </div>
      </div>
    </div>
  );
});
