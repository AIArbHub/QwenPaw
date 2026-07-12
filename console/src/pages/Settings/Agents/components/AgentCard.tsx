import { memo, useState } from "react";
import { Card, Tag, Tooltip, Button, Space, Popconfirm } from "antd";
import { useTranslation } from "react-i18next";
import {
  RobotOutlined,
  EditOutlined,
  DeleteOutlined,
  FolderOpenOutlined,
  HeartOutlined,
} from "@ant-design/icons";
import { EyeOff, Eye } from "lucide-react";
import type { AgentSummary } from "../../../../api/types/agents";
import { useTheme } from "../../../../contexts/ThemeContext";
import { getAgentDisplayName } from "../../../../utils/agentDisplayName";
import { providerIcon } from "../../Models/components/providerIcon";
import styles from "../index.module.less";

interface AgentCardProps {
  agent: AgentSummary;
  onEdit: (agent: AgentSummary) => void;
  onDelete: (agentId: string) => void;
  onToggle: (agentId: string, currentEnabled: boolean) => void;
  onConfigurePersona?: (agent: AgentSummary) => void;
}

export const AgentCard = memo(function AgentCard({
  agent,
  onEdit,
  onDelete,
  onToggle,
  onConfigurePersona,
}: AgentCardProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const isDefault = agent.id === "default";
  const [avatarError, setAvatarError] = useState(false);

  const disabledStyle: React.CSSProperties = isDark
    ? { color: "rgba(255,255,255,0.35)", opacity: 1 }
    : {};

  const iconStyle: React.CSSProperties = isDark
    ? { color: "rgba(255,255,255,0.85)" }
    : {};

  const hasAvatar = agent.avatar && !avatarError;

  return (
    <Card
      hoverable
      className={styles.agentCard}
      onClick={() => onEdit(agent)}
      styles={{ body: { padding: 16 } }}
    >
      {/* Top row: avatar + status */}
      <div className={styles.cardTopRow}>
        <div className={styles.cardAvatar}>
          {hasAvatar ? (
            <img
              src={agent.avatar!}
              alt=""
              className={styles.cardAvatarImg}
              onError={() => setAvatarError(true)}
            />
          ) : (
            <RobotOutlined
              style={{
                fontSize: 24,
                opacity: agent.enabled ? 1 : 0.4,
              }}
            />
          )}
        </div>
        <div className={styles.cardTopRight}>
          {agent.enabled ? (
            <Tag color="success" className={styles.cardStatusTag}>
              {t("common.enabled")}
            </Tag>
          ) : (
            <Tag color="error" className={styles.cardStatusTag}>
              {t("agent.disabled")}
            </Tag>
          )}
        </div>
      </div>

      {/* Title */}
      <div className={styles.cardTitleRow}>
        <span className={styles.cardTitle}>
          {getAgentDisplayName(agent, t)}
        </span>
        {isDefault && (
          <Tag className={styles.defaultBadge}>{t("agent.default")}</Tag>
        )}
      </div>

      {/* ID */}
      <div className={styles.cardId}>ID: {agent.id}</div>

      {/* Description as style hint */}
      {agent.description && (
        <Tooltip title={agent.description} placement="topLeft">
          <p className={styles.cardDesc}>{agent.description}</p>
        </Tooltip>
      )}

      {/* Persona quick-action */}
      {onConfigurePersona && (
        <div
          className={styles.cardPersonaRow}
          onClick={(e) => e.stopPropagation()}
        >
          <Button
            size="small"
            type="text"
            icon={<HeartOutlined />}
            onClick={() => onConfigurePersona(agent)}
            className={styles.cardPersonaBtn}
          >
            {t("persona.soulTitle")}
          </Button>
        </div>
      )}

      {/* Meta info */}
      <div className={styles.cardMeta}>
        {agent.workspace_dir && (
          <div className={styles.cardMetaItem}>
            <FolderOpenOutlined className={styles.cardMetaIcon} />
            <span className={styles.cardMetaText}>{agent.workspace_dir}</span>
          </div>
        )}
        {agent.active_model && (
          <div className={styles.cardMetaItem}>
            <img
              src={providerIcon(agent.active_model.provider_id)}
              alt=""
              style={{ width: 14, height: 14 }}
            />
            <Tooltip title={agent.active_model.model}>
              <span className={styles.cardMetaText}>
                {agent.active_model.model}
              </span>
            </Tooltip>
          </div>
        )}
        {!agent.active_model && (
          <div className={styles.cardMetaItem}>
            <span className={styles.cardMetaText} style={{ opacity: 0.45 }}>
              {t("agent.modelPlaceholder")}
            </span>
          </div>
        )}
      </div>

      {/* Actions */}
      <div
        className={styles.cardActions}
        onClick={(e) => e.stopPropagation()}
      >
        <Space size={4}>
          <Button
            type="text"
            size="small"
            icon={<EditOutlined />}
            onClick={() => onEdit(agent)}
            style={iconStyle}
            title={t("agent.edit")}
          />
          <Popconfirm
            title={
              agent.enabled
                ? t("agent.disableConfirm")
                : t("agent.enableConfirm")
            }
            description={
              agent.enabled
                ? t("agent.disableConfirmDesc")
                : t("agent.enableConfirmDesc")
            }
            onConfirm={() => onToggle(agent.id, agent.enabled)}
            disabled={isDefault}
            okText={t("common.confirm")}
            cancelText={t("common.cancel")}
          >
            <Button
              type="text"
              size="small"
              icon={
                agent.enabled ? <EyeOff size={14} /> : <Eye size={14} />
              }
              disabled={isDefault}
              style={isDefault ? disabledStyle : iconStyle}
              title={
                isDefault
                  ? t("agent.defaultNotDisablable")
                  : undefined
              }
            />
          </Popconfirm>
          <Popconfirm
            title={t("agent.deleteConfirm")}
            description={t("agent.deleteConfirmDesc")}
            onConfirm={() => onDelete(agent.id)}
            disabled={isDefault}
            okText={t("common.confirm")}
            cancelText={t("common.cancel")}
          >
            <Button
              type="link"
              size="small"
              danger
              icon={<DeleteOutlined />}
              disabled={isDefault}
              style={isDefault ? disabledStyle : undefined}
              title={
                isDefault ? t("agent.defaultNotDeletable") : undefined
              }
            />
          </Popconfirm>
        </Space>
      </div>
    </Card>
  );
});
