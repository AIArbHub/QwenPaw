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
  HeartOutlined,
} from "@ant-design/icons";
import type { AgentSummary } from "../../../../api/types/agents";
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
  onConfigurePersona?: (agent: AgentSummary) => void;
}

/**
 * AgentCard — StaffDeck 风格智能体卡片（改造后）。
 *
 * 改造清单（方案文档第 2.2 节）：
 * 1. 隐藏 ID 行
 * 2. 隐藏 workspace_dir
 * 3. 隐藏模型信息
 * 4. 头像溢出设计（headerBar + avatarOverflow）
 * 5. 状态最小化（圆点 + 文字）
 * 6. 新增统计三联格
 * 7. 新增工作风格标签（agent.tags — 当前不渲染）
 * 8. 聊天按钮
 * 9. 卡片圆角 var(--sd-radius-card)
 * 10. 选中态阴影 var(--sd-shadow-float)
 * 11. 操作区移入 DropdownMenu
 */
export const AgentCard = memo(function AgentCard({
  agent,
  stats,
  isSelected,
  onSelect,
  onEdit,
  onChat,
  onDelete,
  onToggle,
  onConfigurePersona,
}: AgentCardProps) {
  const { t } = useTranslation();
  const isDefault = agent.id === "default";
  const [avatarError, setAvatarError] = useState(false);

  const hasAvatar = agent.avatar && !avatarError;
  const isEnabled = agent.enabled;

  const displayName = getAgentDisplayName(agent, t);

  // Dropdown menu items
  const menuItems = [
    {
      key: "edit",
      label: t("agent.edit"),
      icon: <EditOutlined />,
      onClick: ({ domEvent }) => {
        domEvent.stopPropagation();
        onEdit(agent);
      },
    },
    ...(onConfigurePersona
      ? [
          {
            key: "persona",
            label: t("persona.soulTitle"),
            icon: <HeartOutlined />,
            onClick: ({ domEvent }: { domEvent: React.MouseEvent }) => {
              domEvent.stopPropagation();
              onConfigurePersona(agent);
            },
          },
        ]
      : []),
    { type: "divider" as const },
    {
      key: "toggle",
      label: isEnabled ? t("agent.disable") : t("agent.enable"),
      icon: isEnabled ? <EyeInvisibleOutlined /> : <EyeOutlined />,
      disabled: isDefault,
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
      disabled: isDefault,
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

  // Stats values — show `--` when unavailable
  const sessionsValue = stats ? String(stats.sessions) : "--";
  const messagesValue = stats ? String(stats.messages) : "--";
  const lastActiveValue = stats ? stats.lastActive : "--";

  return (
    <div
      className={`${styles.agentCard} ${isSelected ? styles.selected : ""}`}
      onClick={() => {
        onSelect(agent.id);
        onEdit(agent);
      }}
    >
      {/* Dropdown trigger */}
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

      {/* Header bar with overflow avatar */}
      <div className={styles.headerBar}>
        <div className={styles.avatarOverflow}>
          {hasAvatar ? (
            <img
              src={agent.avatar!}
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
              <span className={styles.defaultBadge}>
                {t("agent.default")}
              </span>
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
        {/* Chat button */}
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

      {/* Description (2-line clamp) */}
      {agent.description && (
        <Tooltip title={agent.description} placement="topLeft">
          <p className={styles.desc}>{agent.description}</p>
        </Tooltip>
      )}

      {/* Work style tags — agent.tags not in current type, won't render */}
      {(agent as AgentSummary & { tags?: string[] }).tags &&
        (agent as AgentSummary & { tags?: string[] }).tags!.length > 0 && (
          <div className={styles.tags}>
            {(agent as AgentSummary & { tags?: string[] }).tags!.map(
              (tag) => (
                <span key={tag} className={styles.tagChip}>
                  {tag}
                </span>
              ),
            )}
          </div>
        )}

      {/* Stats tri-grid */}
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
